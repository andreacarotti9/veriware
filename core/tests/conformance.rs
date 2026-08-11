//! Replays `fixtures/vectors.json`.
//!
//! Every vector states the error code the verify path and the decode path must
//! return. The TypeScript suite asserts the same file, so a divergence between
//! the two implementations shows up as a test failure rather than as a support
//! ticket.

use rand::{rngs::StdRng, Rng, SeedableRng};
use serde::Deserialize;
use veriware_core::{
    decode_untrusted_block, decode_untrusted_finalization, decode_untrusted_finalized,
    decode_untrusted_notarization, decode_untrusted_notarized, decode_untrusted_seed,
    view::{BlockView, CertificateView, CertifiedBlockView, SeedView},
    Error, Network, MAX_PAYLOAD_LEN,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bundle {
    max_payload_len: usize,
    networks: std::collections::BTreeMap<String, NetworkFixture>,
    vectors: Vec<Vector>,
    frames: Vec<Frame>,
}

#[derive(Deserialize)]
struct NetworkFixture {
    namespace: String,
    identity: String,
}

#[derive(Deserialize)]
struct Vector {
    name: String,
    kind: String,
    network: String,
    payload: String,
    verify: Option<String>,
    decode: String,
}

#[derive(Deserialize)]
struct Frame {
    name: String,
    network: String,
    frame: String,
    kind: Option<String>,
    expect: String,
}

fn bundle() -> Bundle {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/vectors.json");
    let raw = std::fs::read_to_string(path).expect("run `just fixtures` first");
    serde_json::from_str(&raw).expect("fixtures must parse")
}

fn unhex(hex: &str) -> Vec<u8> {
    assert!(hex.len().is_multiple_of(2), "hex must be byte-aligned");
    hex.as_bytes()
        .chunks(2)
        .map(|pair| {
            let text = std::str::from_utf8(pair).expect("hex is ascii");
            u8::from_str_radix(text, 16).expect("hex digit")
        })
        .collect()
}

impl NetworkFixture {
    fn open(&self) -> Network {
        Network::new(&unhex(&self.namespace), &unhex(&self.identity))
            .expect("fixture networks must be valid")
    }
}

/// Renders a result the way a vector states it: `"ok"` or an error code.
fn code<T>(result: Result<T, Error>) -> String {
    match result {
        Ok(_) => "ok".to_string(),
        Err(error) => error.code().to_string(),
    }
}

/// Both helpers below project to the `view` types before reporting a code, so
/// this suite exercises the same pipeline the WASM bindings do. Skipping the
/// projection would hide `invalid_certificate`, which only surfaces when the
/// lazily decoded signature is finally read.
fn verify(network: &Network, kind: &str, payload: &[u8]) -> Option<String> {
    Some(match kind {
        "seed" => code(network.verify_seed(payload).map(|v| SeedView::from(&v))),
        "notarization" => code(
            network
                .verify_notarization(payload)
                .and_then(|v| CertificateView::try_from(&v)),
        ),
        "finalization" => code(
            network
                .verify_finalization(payload)
                .and_then(|v| CertificateView::try_from(&v)),
        ),
        "notarized" => code(
            network
                .verify_notarized(payload)
                .and_then(|v| CertifiedBlockView::try_from(&v)),
        ),
        "finalized" => code(
            network
                .verify_finalized(payload)
                .and_then(|v| CertifiedBlockView::try_from(&v)),
        ),
        // A bare block carries no certificate, so there is nothing to verify.
        "block" => return None,
        other => panic!("unknown vector kind {other}"),
    })
}

fn decode(kind: &str, payload: &[u8]) -> String {
    match kind {
        "seed" => code(decode_untrusted_seed(payload).map(|v| SeedView::from(&v))),
        "notarization" => {
            code(decode_untrusted_notarization(payload).and_then(|v| CertificateView::try_from(&v)))
        }
        "finalization" => {
            code(decode_untrusted_finalization(payload).and_then(|v| CertificateView::try_from(&v)))
        }
        "notarized" => {
            code(decode_untrusted_notarized(payload).and_then(|v| CertifiedBlockView::try_from(&v)))
        }
        "finalized" => {
            code(decode_untrusted_finalized(payload).and_then(|v| CertifiedBlockView::try_from(&v)))
        }
        "block" => code(decode_untrusted_block(payload).map(|v| BlockView::from(&v))),
        other => panic!("unknown vector kind {other}"),
    }
}

#[test]
fn every_vector_behaves_as_recorded() {
    let bundle = bundle();
    assert!(!bundle.vectors.is_empty(), "fixtures must not be empty");

    for vector in &bundle.vectors {
        let network = bundle
            .networks
            .get(&vector.network)
            .unwrap_or_else(|| panic!("{} names an unknown network", vector.name))
            .open();
        let payload = unhex(&vector.payload);

        assert_eq!(
            verify(&network, &vector.kind, &payload),
            vector.verify,
            "{} verify",
            vector.name
        );
        assert_eq!(
            decode(&vector.kind, &payload),
            vector.decode,
            "{} decode",
            vector.name
        );
    }
}

/// The kind byte the indexer's WebSocket prefixes to every frame. Decoding it is
/// the client's job in TypeScript; this pins the payload half so both sides agree.
#[test]
fn every_frame_behaves_as_recorded() {
    let bundle = bundle();

    for frame in &bundle.frames {
        let network = bundle
            .networks
            .get(&frame.network)
            .unwrap_or_else(|| panic!("{} names an unknown network", frame.name))
            .open();
        let bytes = unhex(&frame.frame);

        let Some((kind, payload)) = bytes.split_first() else {
            assert_eq!(frame.expect, "truncated", "{} empty frame", frame.name);
            assert!(frame.kind.is_none(), "{} must not surface", frame.name);
            continue;
        };

        let observed = match kind {
            0 => verify(&network, "seed", payload),
            1 => verify(&network, "notarized", payload),
            2 => verify(&network, "finalized", payload),
            _ => Some(Error::UnknownKind(*kind).code().to_string()),
        };
        assert_eq!(
            observed.as_deref(),
            Some(frame.expect.as_str()),
            "{}",
            frame.name
        );
    }
}

#[test]
fn fixtures_agree_with_the_compiled_payload_cap() {
    assert_eq!(bundle().max_payload_len, MAX_PAYLOAD_LEN);
}

#[test]
fn the_cap_leaves_headroom_above_a_real_certified_block() {
    let bundle = bundle();
    let largest = bundle
        .vectors
        .iter()
        .filter(|vector| vector.verify.as_deref() == Some("ok"))
        .map(|vector| vector.payload.len() / 2)
        .max()
        .expect("fixtures contain valid vectors");

    assert!(largest < MAX_PAYLOAD_LEN, "{largest} bytes exceeds the cap");
    assert!(
        largest * 2 < MAX_PAYLOAD_LEN,
        "the cap should leave room for upstream to add a field ({largest} bytes today)"
    );
}

/// The property the trust boundary rests on: nothing reachable from the public
/// API panics, whatever the input. A panic in WASM poisons the module instance,
/// so a crash here is a denial of service in production.
#[test]
fn random_bytes_never_panic_and_never_verify() {
    let bundle = bundle();
    let network = bundle.networks["devnet"].open();
    let mut rng = StdRng::seed_from_u64(1);

    // Lengths straddle the cap so the length check, the decoder, and the
    // signature check all see traffic.
    for length in [
        0usize, 1, 2, 7, 48, 96, 145, 200, 331, 1023, 1024, 1025, 4096,
    ] {
        for _ in 0..64 {
            let mut payload = vec![0u8; length];
            rng.fill_bytes(&mut payload);

            for kind in [
                "seed",
                "notarization",
                "finalization",
                "notarized",
                "finalized",
            ] {
                assert_ne!(
                    verify(&network, kind, &payload),
                    Some("ok".to_string()),
                    "random bytes verified as {kind}"
                );
                let _ = decode(kind, &payload);
            }
            let _ = decode("block", &payload);
        }
    }
}

/// Truncating a valid certificate at every offset is the cheapest way to reach
/// a decoder's partially-initialized states.
#[test]
fn every_prefix_of_a_valid_certificate_is_rejected() {
    let bundle = bundle();
    let network = bundle.networks["devnet"].open();
    let valid = bundle
        .vectors
        .iter()
        .find(|vector| vector.name == "finalized/valid")
        .expect("fixtures contain finalized/valid");
    let payload = unhex(&valid.payload);

    for length in 0..payload.len() {
        assert_ne!(
            verify(&network, "finalized", &payload[..length]),
            Some("ok".to_string()),
            "a {length}-byte prefix must not verify"
        );
    }
    assert_eq!(
        verify(&network, "finalized", &payload),
        Some("ok".to_string())
    );
}

#[test]
fn identities_and_namespaces_are_validated() {
    for rejected in [vec![], vec![0u8; 95], vec![0u8; 96], vec![0xff; 96]] {
        assert_eq!(
            Network::alto(&rejected).err(),
            Some(Error::InvalidIdentity),
            "{}-byte identity",
            rejected.len()
        );
    }

    let identity = unhex(&bundle().networks["devnet"].identity);
    assert!(Network::new(&[0u8; 256], &identity).is_ok());
    assert_eq!(
        Network::new(&[0u8; 257], &identity).err(),
        Some(Error::NamespaceTooLarge {
            limit: 256,
            actual: 257
        })
    );
}
