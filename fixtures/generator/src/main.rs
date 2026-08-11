//! Generates the golden certificate vectors that pin veriware's conformance.
//!
//! Two deterministic devnets are stood up from a seeded RNG - one on alto's
//! `_ALTO` namespace, one on a different namespace - and every certificate they
//! can produce is emitted alongside a tampered variant for each way a
//! certificate can be wrong. Each vector records the error code the verify path
//! and the decode path are expected to return, so the Rust suite and the
//! TypeScript suite can assert against the same file.
//!
//! Run with `just fixtures`. The output is byte-stable: a diff means behavior
//! changed, and `just fixtures-check` fails until that change is deliberate.

use alto_types::{
    Block, Context, Finalization, Finalized, Identity, Notarization, Notarized, PublicKey, Scheme,
    Seedable, EPOCH, NAMESPACE,
};
use commonware_codec::Encode;
use commonware_consensus::{
    simplex::{
        scheme::bls12381_threshold::vrf,
        types::{Finalize, Notarize, Proposal},
    },
    types::{Height, Round, View},
};
use commonware_cryptography::{
    bls12381::primitives::variant::MinSig, certificate::mocks::Fixture, sha256, Digest as _,
    Digestible,
};
use commonware_parallel::Sequential;
use rand::{rngs::StdRng, SeedableRng};
use serde::Serialize;
use std::{collections::BTreeMap, path::PathBuf};

/// Seed for the RNG that produces the devnet keys. Never change it: the
/// committed identities are derived from it.
const RNG_SEED: u64 = 0;

/// Validators per devnet. Four gives a quorum of three, so the certificates
/// exercise real threshold recovery rather than a single signer.
const VALIDATORS: u32 = 4;

/// A second signing namespace. Certificates signed under it must fail against
/// alto's namespace even when the verifier is handed the right identity - that
/// is what makes the namespace load-bearing rather than decorative.
const ALT_NAMESPACE: &[u8] = b"_VERIWARE_TEST";

/// Mirrors `veriware_core::MAX_PAYLOAD_LEN`. Duplicated rather than imported so
/// the generator does not depend on the crate it generates fixtures for.
const MAX_PAYLOAD_LEN: usize = 1024;

fn main() {
    let directory = PathBuf::from(
        std::env::args()
            .nth(1)
            .unwrap_or_else(|| "fixtures".to_string()),
    );
    let bundle = build();
    let mut json = serde_json::to_string_pretty(&bundle).expect("fixtures must serialize");
    json.push('\n');

    std::fs::create_dir_all(&directory).expect("fixtures directory must be creatable");
    let path = directory.join("vectors.json");
    std::fs::write(&path, json).expect("fixtures must be writable");
    println!(
        "wrote {} vectors to {}",
        bundle.vectors.len(),
        path.display()
    );
}

// -- output shapes ----------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Bundle {
    generated_by: &'static str,
    about: &'static str,
    rng_seed: u64,
    validators: u32,
    max_payload_len: usize,
    networks: BTreeMap<&'static str, NetworkFixture>,
    vectors: Vec<Vector>,
    frames: Vec<Frame>,
}

/// A devnet a vector can be verified against.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NetworkFixture {
    namespace: String,
    identity: String,
    about: &'static str,
}

/// One payload and what both entry points must do with it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Vector {
    /// Stable identifier. Test failures quote it.
    name: &'static str,
    /// Which entry point to feed it to.
    kind: &'static str,
    /// Key into `networks`.
    network: &'static str,
    /// The payload, hex-encoded.
    payload: String,
    /// Expected result of `verify_*`: `"ok"`, an error code, or `null` where the
    /// kind has no verify path (a bare block carries no certificate).
    verify: Option<&'static str>,
    /// Expected result of `decode_untrusted_*`: `"ok"` or an error code.
    decode: &'static str,
    /// Why this vector exists.
    about: &'static str,
}

/// One WebSocket frame: a kind byte followed by a payload.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Frame {
    name: &'static str,
    network: &'static str,
    /// The frame as it arrives on the wire, hex-encoded.
    frame: String,
    /// Which message the client should surface, or `null` if it must reject.
    kind: Option<&'static str>,
    /// Expected result: `"ok"` or an error code.
    expect: &'static str,
    about: &'static str,
}

// -- devnet -----------------------------------------------------------------

/// A deterministic threshold-simplex network with enough validators for a quorum.
struct Devnet {
    schemes: Vec<Scheme>,
    participants: Vec<PublicKey>,
    identity: Identity,
}

impl Devnet {
    fn new(rng: &mut StdRng, namespace: &[u8]) -> Self {
        let Fixture {
            schemes,
            participants,
            ..
        } = vrf::fixture::<MinSig, _>(rng, namespace, VALIDATORS);
        let identity = *schemes
            .first()
            .expect("fixture must produce at least one scheme")
            .identity();

        Self {
            schemes,
            participants,
            identity,
        }
    }

    fn signer(&self) -> &Scheme {
        self.schemes.first().expect("devnet must have a signer")
    }

    /// Builds a block at `view` extending `parent`.
    fn block(&self, view: u64, parent_view: u64, parent: sha256::Digest, height: u64) -> Block {
        let leader = self
            .participants
            .get(view as usize % self.participants.len())
            .expect("leader index is taken modulo the participant count")
            .clone();
        let context = Context {
            round: Round::new(EPOCH, View::new(view)),
            leader,
            parent: (View::new(parent_view), parent),
        };
        // Fixed timestamps keep the output byte-stable across runs.
        Block::new(
            context,
            parent,
            Height::new(height),
            1_760_000_000_000 + view,
        )
    }

    fn proposal(&self, block: &Block, parent_view: u64) -> Proposal<sha256::Digest> {
        Proposal::new(block.context.round, View::new(parent_view), block.digest())
    }

    fn notarization(&self, proposal: &Proposal<sha256::Digest>) -> Notarization {
        let votes: Vec<_> = self
            .schemes
            .iter()
            .map(|scheme| {
                Notarize::sign(scheme, proposal.clone()).expect("devnet signer must sign")
            })
            .collect();
        Notarization::from_notarizes(self.signer(), &votes, &Sequential)
            .expect("a full committee must reach quorum")
    }

    fn finalization(&self, proposal: &Proposal<sha256::Digest>) -> Finalization {
        let votes: Vec<_> = self
            .schemes
            .iter()
            .map(|scheme| {
                Finalize::sign(scheme, proposal.clone()).expect("devnet signer must sign")
            })
            .collect();
        Finalization::from_finalizes(self.signer(), &votes, &Sequential)
            .expect("a full committee must reach quorum")
    }
}

// -- vectors ----------------------------------------------------------------

/// Length of a MinSig signature: one compressed G1 element.
const SIGNATURE_LEN: usize = 48;

fn build() -> Bundle {
    let mut rng = StdRng::seed_from_u64(RNG_SEED);
    let alto = Devnet::new(&mut rng, NAMESPACE);
    let alt = Devnet::new(&mut rng, ALT_NAMESPACE);

    // A two-block chain: genesis at view 1, its child at view 9. Two heights let
    // the demo show progress and exercise different varint widths.
    let genesis = alto.block(1, 0, sha256::Digest::EMPTY, 1);
    let child = alto.block(9, 1, genesis.digest(), 2);

    let genesis_proposal = alto.proposal(&genesis, 0);
    let child_proposal = alto.proposal(&child, 1);

    let notarization = alto.notarization(&child_proposal);
    let finalization = alto.finalization(&child_proposal);
    let genesis_finalization = alto.finalization(&genesis_proposal);
    let seed = notarization.seed();
    // A genuine signature from a different round: a forgery that is a real point
    // on the curve, which a bit flip usually is not.
    let foreign_seed_signature = genesis_finalization.seed().signature.encode().to_vec();

    let notarized = Notarized::new(notarization.clone(), child.clone())
        .encode()
        .to_vec();
    let finalized = Finalized::new(finalization.clone(), child.clone())
        .encode()
        .to_vec();
    let genesis_finalized = Finalized::new(genesis_finalization, genesis.clone())
        .encode()
        .to_vec();

    let seed_bytes = seed.encode().to_vec();
    let notarization_bytes = notarization.encode().to_vec();
    let finalization_bytes = finalization.encode().to_vec();
    let block_bytes = child.encode().to_vec();

    // The alt devnet signs the same round, so the only difference from the alto
    // seed is the namespace and the keys behind it.
    let alt_child = alt.block(9, 1, sha256::Digest::EMPTY, 2);
    let alt_seed = alt
        .notarization(&alt.proposal(&alt_child, 1))
        .seed()
        .encode()
        .to_vec();

    // `Signature` is two 48-byte MinSig group elements, vote first, seed second,
    // and it sits at the end of a bare certificate.
    let vote_signature_at = notarization_bytes.len() - 2 * SIGNATURE_LEN;
    let seed_signature_at = notarization_bytes.len() - SIGNATURE_LEN;
    // The finalization covers the same proposal, so its vote signature is a real
    // point over a different message: a forgery that decodes perfectly.
    let foreign_vote_signature =
        finalization_bytes[vote_signature_at..vote_signature_at + SIGNATURE_LEN].to_vec();

    let vectors = vec![
        // -- seeds --
        Vector {
            name: "seed/valid",
            kind: "seed",
            network: "devnet",
            payload: hex(&seed_bytes),
            verify: Some("ok"),
            decode: "ok",
            about: "The per-view VRF seed recovered from a notarization.",
        },
        Vector {
            name: "seed/foreign-signature",
            kind: "seed",
            network: "devnet",
            payload: hex(&replace_tail(&seed_bytes, &foreign_seed_signature)),
            verify: Some("invalid_signature"),
            decode: "ok",
            about: "This network's real signature, for the wrong round. Decodes \
                    cleanly and fails only on the signature check, which a bit \
                    flip cannot test: a flipped compressed point usually stops \
                    being a point at all.",
        },
        Vector {
            name: "seed/non-point-signature",
            kind: "seed",
            network: "devnet",
            payload: hex(&saturate_tail(&seed_bytes, SIGNATURE_LEN)),
            verify: Some("malformed"),
            decode: "malformed",
            about: "Signature bytes that are not on the curve. A seed decodes its \
                    signature eagerly, so this is caught while reading.",
        },
        Vector {
            name: "seed/truncated",
            kind: "seed",
            network: "devnet",
            payload: hex(&seed_bytes[..seed_bytes.len() - 8]),
            verify: Some("truncated"),
            decode: "truncated",
            about: "Signature cut short mid-field.",
        },
        Vector {
            name: "seed/trailing-bytes",
            kind: "seed",
            network: "devnet",
            payload: hex(&[seed_bytes.clone(), vec![0x00, 0x00]].concat()),
            verify: Some("trailing_bytes"),
            decode: "trailing_bytes",
            about: "A valid seed with junk appended. Must not be accepted.",
        },
        Vector {
            name: "seed/empty",
            kind: "seed",
            network: "devnet",
            payload: String::new(),
            verify: Some("truncated"),
            decode: "truncated",
            about: "Zero bytes.",
        },
        Vector {
            name: "seed/from-another-network",
            kind: "seed",
            network: "devnet",
            payload: hex(&alt_seed),
            verify: Some("invalid_signature"),
            decode: "ok",
            about: "A genuine seed from a network with a different namespace and \
                    identity, offered to the alto devnet.",
        },
        Vector {
            name: "seed/valid-on-alt-network",
            kind: "seed",
            network: "alt",
            payload: hex(&alt_seed),
            verify: Some("ok"),
            decode: "ok",
            about: "The same payload against its own network. Proves the \
                    namespace and identity are parameters, not constants.",
        },
        // -- bare notarization certificates --
        Vector {
            name: "notarization/valid",
            kind: "notarization",
            network: "devnet",
            payload: hex(&notarization_bytes),
            verify: Some("ok"),
            decode: "ok",
            about: "A notarization certificate without the block it certifies.",
        },
        Vector {
            name: "notarization/foreign-vote-signature",
            kind: "notarization",
            network: "devnet",
            payload: hex(&replace_at(
                &notarization_bytes,
                vote_signature_at,
                &foreign_vote_signature,
            )),
            verify: Some("invalid_signature"),
            decode: "ok",
            about: "The finalization's vote signature over the same proposal. \
                    Notarizing and finalizing sign different messages, so this is \
                    a real signature that means the wrong thing.",
        },
        Vector {
            name: "notarization/foreign-seed-signature",
            kind: "notarization",
            network: "devnet",
            payload: hex(&replace_at(
                &notarization_bytes,
                seed_signature_at,
                &foreign_seed_signature,
            )),
            verify: Some("invalid_signature"),
            decode: "ok",
            about: "Vote signature intact, seed signature taken from another \
                    round. Both halves of the certificate are checked.",
        },
        Vector {
            name: "notarization/non-point-signature",
            kind: "notarization",
            network: "devnet",
            payload: hex(&saturate_tail(&notarization_bytes, 2 * SIGNATURE_LEN)),
            verify: Some("invalid_signature"),
            decode: "invalid_certificate",
            about: "Signature bytes that are not points on the curve. A \
                    certificate decodes its signature lazily, so this is where \
                    the verify and decode paths diverge.",
        },
        Vector {
            name: "notarization/is-a-finalization",
            kind: "notarization",
            network: "devnet",
            payload: hex(&finalization_bytes),
            verify: Some("invalid_signature"),
            decode: "ok",
            about: "Notarizations and finalizations encode identically and are \
                    told apart only by the message they sign.",
        },
        Vector {
            name: "notarization/oversized",
            kind: "notarization",
            network: "devnet",
            payload: hex(&pad_to(&notarization_bytes, MAX_PAYLOAD_LEN + 1)),
            verify: Some("too_large"),
            decode: "too_large",
            about: "Rejected on length before a decoder sees it.",
        },
        // -- bare finalization certificates --
        Vector {
            name: "finalization/valid",
            kind: "finalization",
            network: "devnet",
            payload: hex(&finalization_bytes),
            verify: Some("ok"),
            decode: "ok",
            about: "A finalization certificate without the block it certifies.",
        },
        Vector {
            name: "finalization/is-a-notarization",
            kind: "finalization",
            network: "devnet",
            payload: hex(&notarization_bytes),
            verify: Some("invalid_signature"),
            decode: "ok",
            about: "The mirror of notarization/is-a-finalization: a notarization \
                    must not be mistaken for finality.",
        },
        // -- certified blocks --
        Vector {
            name: "notarized/valid",
            kind: "notarized",
            network: "devnet",
            payload: hex(&notarized),
            verify: Some("ok"),
            decode: "ok",
            about: "What alto's /notarization endpoint serves: certificate plus block.",
        },
        Vector {
            name: "notarized/swapped-block",
            kind: "notarized",
            network: "devnet",
            payload: hex(&[notarization_bytes.clone(), genesis.encode().to_vec()].concat()),
            verify: Some("inconsistent"),
            decode: "inconsistent",
            about: "A real certificate stapled to a different real block. Caught \
                    while decoding, since the digest binding is structural.",
        },
        Vector {
            name: "notarized/truncated",
            kind: "notarized",
            network: "devnet",
            payload: hex(&notarized[..notarized.len() - 5]),
            verify: Some("truncated"),
            decode: "truncated",
            about: "Block cut short after a complete certificate.",
        },
        Vector {
            name: "finalized/valid",
            kind: "finalized",
            network: "devnet",
            payload: hex(&finalized),
            verify: Some("ok"),
            decode: "ok",
            about: "What alto's /finalization and /block/latest endpoints serve.",
        },
        Vector {
            name: "finalized/valid-parent",
            kind: "finalized",
            network: "devnet",
            payload: hex(&genesis_finalized),
            verify: Some("ok"),
            decode: "ok",
            about: "The parent of finalized/valid. Two heights make a chain the \
                    demo can walk.",
        },
        Vector {
            name: "finalized/tampered-block",
            kind: "finalized",
            network: "devnet",
            payload: hex(&flip_bit(&finalized, finalized.len() - 1)),
            verify: Some("inconsistent"),
            decode: "inconsistent",
            about: "A byte of the block changed, which changes its digest, which \
                    breaks the binding to the certificate.",
        },
        Vector {
            name: "finalized/oversized",
            kind: "finalized",
            network: "devnet",
            payload: hex(&pad_to(&finalized, MAX_PAYLOAD_LEN + 1)),
            verify: Some("too_large"),
            decode: "too_large",
            about: "Rejected on length before a decoder sees it.",
        },
        // -- bare blocks --
        Vector {
            name: "block/valid",
            kind: "block",
            network: "devnet",
            payload: hex(&block_bytes),
            verify: None,
            decode: "ok",
            about: "A block on its own. Nothing certifies it, so there is nothing \
                    to verify.",
        },
        Vector {
            name: "block/truncated",
            kind: "block",
            network: "devnet",
            payload: hex(&block_bytes[..block_bytes.len() - 3]),
            verify: None,
            decode: "truncated",
            about: "Block cut short mid-field.",
        },
        Vector {
            name: "block/trailing-bytes",
            kind: "block",
            network: "devnet",
            payload: hex(&[block_bytes.clone(), vec![0xff]].concat()),
            verify: None,
            decode: "trailing_bytes",
            about: "A valid block with junk appended.",
        },
    ];

    let frames = vec![
        Frame {
            name: "frame/seed",
            network: "devnet",
            frame: hex(&frame(0, &seed_bytes)),
            kind: Some("seed"),
            expect: "ok",
            about: "Kind byte 0. The indexer's WebSocket frames a seed this way.",
        },
        Frame {
            name: "frame/notarization",
            network: "devnet",
            frame: hex(&frame(1, &notarized)),
            kind: Some("notarization"),
            expect: "ok",
            about: "Kind byte 1 carries a certificate plus its block, not a bare \
                    certificate.",
        },
        Frame {
            name: "frame/finalization",
            network: "devnet",
            frame: hex(&frame(2, &finalized)),
            kind: Some("finalization"),
            expect: "ok",
            about: "Kind byte 2, likewise certificate plus block.",
        },
        Frame {
            name: "frame/tampered-seed",
            network: "devnet",
            frame: hex(&frame(
                0,
                &replace_tail(&seed_bytes, &foreign_seed_signature),
            )),
            kind: None,
            expect: "invalid_signature",
            about: "A framed forgery. The client must drop it.",
        },
        Frame {
            name: "frame/unknown-kind",
            network: "devnet",
            frame: hex(&frame(7, &seed_bytes)),
            kind: None,
            expect: "unknown_kind",
            about: "A kind byte from a future protocol version.",
        },
        Frame {
            name: "frame/empty",
            network: "devnet",
            frame: String::new(),
            kind: None,
            expect: "truncated",
            about: "A zero-length frame: not even a kind byte to read.",
        },
    ];

    Bundle {
        generated_by: "just fixtures",
        about: "Golden vectors for veriware. Regenerating must not change this \
                file; if it does, verification behavior changed.",
        rng_seed: RNG_SEED,
        validators: VALIDATORS,
        max_payload_len: MAX_PAYLOAD_LEN,
        networks: BTreeMap::from([
            (
                "devnet",
                NetworkFixture {
                    namespace: hex(NAMESPACE),
                    identity: hex(&alto.identity.encode()),
                    about: "Deterministic alto devnet. Never a live network.",
                },
            ),
            (
                "alt",
                NetworkFixture {
                    namespace: hex(ALT_NAMESPACE),
                    identity: hex(&alt.identity.encode()),
                    about: "A second devnet on a different namespace, standing in \
                            for any non-alto threshold-simplex chain.",
                },
            ),
        ]),
        vectors,
        frames,
    }
}

// -- helpers ----------------------------------------------------------------

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Overwrites the last `replacement.len()` bytes.
fn replace_tail(bytes: &[u8], replacement: &[u8]) -> Vec<u8> {
    let start = bytes.len().saturating_sub(replacement.len());
    replace_at(bytes, start, replacement)
}

/// Overwrites `replacement.len()` bytes starting at `offset`.
fn replace_at(bytes: &[u8], offset: usize, replacement: &[u8]) -> Vec<u8> {
    let mut tampered = bytes.to_vec();
    tampered[offset..offset + replacement.len()].copy_from_slice(replacement);
    tampered
}

/// Flips the low bit of one byte, leaving length and structure intact.
fn flip_bit(bytes: &[u8], index: usize) -> Vec<u8> {
    let mut tampered = bytes.to_vec();
    if let Some(byte) = tampered.get_mut(index) {
        *byte ^= 0x01;
    }
    tampered
}

/// Replaces the last `count` bytes with `0xff`, which is not a valid compressed
/// group element.
fn saturate_tail(bytes: &[u8], count: usize) -> Vec<u8> {
    let mut tampered = bytes.to_vec();
    let start = tampered.len().saturating_sub(count);
    tampered[start..].fill(0xff);
    tampered
}

/// Appends zeroes until the payload is exactly `length` bytes.
fn pad_to(bytes: &[u8], length: usize) -> Vec<u8> {
    let mut padded = bytes.to_vec();
    padded.resize(length, 0x00);
    padded
}

/// Prefixes a payload with a WebSocket kind byte.
fn frame(kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut framed = vec![kind];
    framed.extend_from_slice(payload);
    framed
}
