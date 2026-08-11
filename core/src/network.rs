//! The verification handle: a signing namespace plus a threshold identity.

use crate::{decode::bounded, Error, MAX_NAMESPACE_LEN};
use alto_types::{
    Finalization, Finalized, Identity, Notarization, Notarized, Scheme, Seed, NAMESPACE,
};
use commonware_codec::DecodeExt;
use commonware_parallel::Sequential;
use commonware_utils::sys_rng;

/// A threshold-simplex network veriware can verify certificates against.
///
/// A network is exactly two things: the namespace its validators prefix to every
/// signed message, and the threshold public key their signatures recover to.
/// Alto is one instance of that pair ([`Network::alto`]); any other
/// threshold-simplex chain is another ([`Network::new`]).
///
/// Constructing a `Network` decodes the identity and precomputes the namespace
/// derivations once, so verification does no setup work per certificate. Reuse
/// one handle for the lifetime of a connection.
#[derive(Clone, Debug)]
pub struct Network {
    identity: Identity,
    scheme: Scheme,
}

impl Network {
    /// Builds a network from a signing namespace and an encoded threshold identity.
    ///
    /// `identity` is the network's public key as it appears on the wire: for the
    /// BLS12-381 MinSig variant used by threshold-simplex, a 96-byte compressed
    /// G2 element.
    ///
    /// # Errors
    ///
    /// [`Error::NamespaceTooLarge`] if the namespace exceeds
    /// [`MAX_NAMESPACE_LEN`], [`Error::InvalidIdentity`] if the identity is not a
    /// point on the curve.
    pub fn new(namespace: &[u8], identity: &[u8]) -> Result<Self, Error> {
        if namespace.len() > MAX_NAMESPACE_LEN {
            return Err(Error::NamespaceTooLarge {
                limit: MAX_NAMESPACE_LEN,
                actual: namespace.len(),
            });
        }
        let identity = Identity::decode(identity).map_err(|_| Error::InvalidIdentity)?;

        Ok(Self {
            identity,
            scheme: Scheme::certificate_verifier(namespace, identity),
        })
    }

    /// Builds an alto network: [`Network::new`] with the `_ALTO` namespace.
    ///
    /// Alto hardcodes epoch 0 - it has no resharing - so the identity never
    /// rotates and a handle stays valid for the life of the chain.
    pub fn alto(identity: &[u8]) -> Result<Self, Error> {
        Self::new(NAMESPACE, identity)
    }

    /// The decoded threshold identity this network verifies against.
    pub const fn identity(&self) -> &Identity {
        &self.identity
    }

    /// Decodes a seed and checks its threshold signature.
    ///
    /// The seed is the per-view VRF output: a signature over the round alone,
    /// which makes it unpredictable before the view and deterministic after.
    pub fn verify_seed(&self, payload: &[u8]) -> Result<Seed, Error> {
        let seed: Seed = bounded(payload)?;
        if !seed.verify(&self.scheme) {
            return Err(Error::InvalidSignature);
        }
        Ok(seed)
    }

    /// Decodes a bare notarization certificate and checks its threshold signature.
    ///
    /// A notarization means at least `2f+1` validators voted for the proposal. It
    /// is not finality: a notarized view can still be skipped.
    pub fn verify_notarization(&self, payload: &[u8]) -> Result<Notarization, Error> {
        let notarization: Notarization = bounded(payload)?;
        if !notarization.verify(&mut sys_rng(), &self.scheme, &Sequential) {
            return Err(Error::InvalidSignature);
        }
        Ok(notarization)
    }

    /// Decodes a bare finalization certificate and checks its threshold signature.
    ///
    /// A finalization is irreversible: the proposal it names is part of the chain
    /// forever, and so is every ancestor.
    pub fn verify_finalization(&self, payload: &[u8]) -> Result<Finalization, Error> {
        let finalization: Finalization = bounded(payload)?;
        if !finalization.verify(&mut sys_rng(), &self.scheme, &Sequential) {
            return Err(Error::InvalidSignature);
        }
        Ok(finalization)
    }

    /// Decodes an alto notarization together with the block it certifies, and
    /// checks the threshold signature.
    ///
    /// This is what alto's `/notarization/*` endpoint serves. Decoding already
    /// rejects a payload whose block does not hash to the digest the certificate
    /// attests to, so a success here binds the certificate to *this* block.
    pub fn verify_notarized(&self, payload: &[u8]) -> Result<Notarized, Error> {
        let notarized: Notarized = bounded(payload)?;
        if !notarized.verify(&self.scheme, &Sequential) {
            return Err(Error::InvalidSignature);
        }
        Ok(notarized)
    }

    /// Decodes an alto finalization together with the block it certifies, and
    /// checks the threshold signature.
    ///
    /// This is what alto's `/finalization/*` and `/block/latest` endpoints serve.
    pub fn verify_finalized(&self, payload: &[u8]) -> Result<Finalized, Error> {
        let finalized: Finalized = bounded(payload)?;
        if !finalized.verify(&self.scheme, &Sequential) {
            return Err(Error::InvalidSignature);
        }
        Ok(finalized)
    }
}
