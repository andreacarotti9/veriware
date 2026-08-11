//! Flat, serializable projections of the decoded types.
//!
//! The upstream types are generic over schemes and digests and carry lazily
//! decoded fields; these are the shapes that cross the WASM boundary. Byte
//! fields become `Uint8Array` and `u64` fields become `bigint` - a view or a
//! height is attacker-controlled and can exceed `Number.MAX_SAFE_INTEGER`, and
//! silently rounding a verified value is worse than making callers write `n`.

use crate::Error;
use alto_types::{Block, Finalization, Finalized, Notarization, Notarized, Seed};
use commonware_codec::Encode;
use commonware_consensus::simplex::{scheme::bls12381_threshold::vrf, types::Proposal};
use commonware_cryptography::{bls12381::primitives::variant::MinSig, sha256::Digest, Digestible};
use serde::{Serialize, Serializer};

/// A byte string that serializes as `Uint8Array` rather than as an array of numbers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Bytes(Vec<u8>);

impl Serialize for Bytes {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_bytes(&self.0)
    }
}

impl From<Vec<u8>> for Bytes {
    fn from(bytes: Vec<u8>) -> Self {
        Self(bytes)
    }
}

impl From<&Digest> for Bytes {
    fn from(digest: &Digest) -> Self {
        Self(digest.to_vec())
    }
}

/// A verified seed: the per-view randomness beacon.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedView {
    /// Epoch of the round this seed belongs to. Always 0 on alto.
    pub epoch: u64,
    /// View of the round this seed belongs to.
    pub view: u64,
    /// The threshold signature, which *is* the randomness.
    pub signature: Bytes,
}

impl From<&Seed> for SeedView {
    fn from(seed: &Seed) -> Self {
        Self {
            epoch: seed.round.epoch().get(),
            view: seed.round.view().get(),
            signature: seed.signature.encode().to_vec().into(),
        }
    }
}

/// A verified notarization or finalization certificate.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificateView {
    /// Epoch of the certified round. Always 0 on alto.
    pub epoch: u64,
    /// View of the certified round.
    pub view: u64,
    /// View of the proposal this one builds on.
    pub parent: u64,
    /// What was certified: the digest of the proposed block.
    pub payload: Bytes,
    /// Recovered threshold signature over the vote.
    pub vote_signature: Bytes,
    /// Recovered threshold signature over the round, i.e. the seed for this view.
    pub seed_signature: Bytes,
}

impl CertificateView {
    fn build(
        proposal: &Proposal<Digest>,
        certificate: &vrf::Certificate<MinSig>,
    ) -> Result<Self, Error> {
        // `Lazy` defers signature decoding, so a certificate can parse and still
        // hold bytes that are not group elements. Verification rejects those, but
        // the untrusted decode path reaches here too.
        let signature = certificate.get().ok_or(Error::InvalidCertificate)?;
        Ok(Self {
            epoch: proposal.round.epoch().get(),
            view: proposal.round.view().get(),
            parent: proposal.parent.get(),
            payload: (&proposal.payload).into(),
            vote_signature: signature.vote_signature.encode().to_vec().into(),
            seed_signature: signature.seed_signature.encode().to_vec().into(),
        })
    }
}

impl TryFrom<&Notarization> for CertificateView {
    type Error = Error;

    fn try_from(notarization: &Notarization) -> Result<Self, Error> {
        Self::build(&notarization.proposal, &notarization.certificate)
    }
}

impl TryFrom<&Finalization> for CertificateView {
    type Error = Error;

    fn try_from(finalization: &Finalization) -> Result<Self, Error> {
        Self::build(&finalization.proposal, &finalization.certificate)
    }
}

/// The consensus context a block was proposed in.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextView {
    /// Epoch of the round the block was proposed in.
    pub epoch: u64,
    /// View of the round the block was proposed in.
    pub view: u64,
    /// Identity key of the validator that proposed it.
    pub leader: Bytes,
    /// View of the proposal it builds on.
    pub parent_view: u64,
    /// Payload digest of the proposal it builds on.
    pub parent_payload: Bytes,
}

/// A decoded alto block.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockView {
    /// SHA-256 digest of the block. This is what certificates attest to.
    pub digest: Bytes,
    /// Digest of the parent block.
    pub parent: Bytes,
    /// Height in the chain.
    pub height: u64,
    /// Proposer's clock at proposal time, in milliseconds since the Unix epoch.
    /// Validator-supplied: treat it as a hint, not as a timestamp.
    pub timestamp: u64,
    /// The consensus context the block was proposed in.
    pub context: ContextView,
}

impl From<&Block> for BlockView {
    fn from(block: &Block) -> Self {
        Self {
            digest: (&block.digest()).into(),
            parent: (&block.parent).into(),
            height: block.height.get(),
            timestamp: block.timestamp,
            context: ContextView {
                epoch: block.context.round.epoch().get(),
                view: block.context.round.view().get(),
                leader: block.context.leader.to_vec().into(),
                parent_view: block.context.parent.0.get(),
                parent_payload: (&block.context.parent.1).into(),
            },
        }
    }
}

/// A certificate together with the block it certifies.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertifiedBlockView {
    /// The certificate.
    pub proof: CertificateView,
    /// The block it attests to. Its digest equals `proof.payload`.
    pub block: BlockView,
}

impl TryFrom<&Notarized> for CertifiedBlockView {
    type Error = Error;

    fn try_from(notarized: &Notarized) -> Result<Self, Error> {
        Ok(Self {
            proof: (&notarized.proof).try_into()?,
            block: (&notarized.block).into(),
        })
    }
}

impl TryFrom<&Finalized> for CertifiedBlockView {
    type Error = Error;

    fn try_from(finalized: &Finalized) -> Result<Self, Error> {
        Ok(Self {
            proof: (&finalized.proof).try_into()?,
            block: (&finalized.block).into(),
        })
    }
}
