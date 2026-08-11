//! Decoding without verification.
//!
//! Every function here answers what a payload claims to be, and nothing about
//! whether the claim is true. The results are attacker-controlled, and are
//! useful for explaining a rejection. To learn whether a certificate is real,
//! use [`crate::Network`].

use crate::{Error, MAX_PAYLOAD_LEN};
use alto_types::{Block, Finalization, Finalized, Notarization, Notarized, Seed};
use commonware_codec::DecodeExt;

/// Length-caps the payload, then decodes it.
///
/// The cap runs first: decoding is the first place attacker-controlled bytes
/// drive allocation.
pub(crate) fn bounded<T: DecodeExt<()>>(payload: &[u8]) -> Result<T, Error> {
    if payload.len() > MAX_PAYLOAD_LEN {
        return Err(Error::TooLarge {
            limit: MAX_PAYLOAD_LEN,
            actual: payload.len(),
        });
    }
    T::decode(payload).map_err(Error::from)
}

/// Decodes a seed. **The signature is not checked.**
pub fn decode_untrusted_seed(payload: &[u8]) -> Result<Seed, Error> {
    bounded(payload)
}

/// Decodes a bare notarization certificate. **The signature is not checked.**
pub fn decode_untrusted_notarization(payload: &[u8]) -> Result<Notarization, Error> {
    bounded(payload)
}

/// Decodes a bare finalization certificate. **The signature is not checked.**
pub fn decode_untrusted_finalization(payload: &[u8]) -> Result<Finalization, Error> {
    bounded(payload)
}

/// Decodes a notarization certificate together with the alto block it certifies.
/// **The signature is not checked.**
///
/// The block's digest is still required to match the certificate's payload - that
/// is a structural property of the encoding, not evidence of anything.
pub fn decode_untrusted_notarized(payload: &[u8]) -> Result<Notarized, Error> {
    bounded(payload)
}

/// Decodes a finalization certificate together with the alto block it certifies.
/// **The signature is not checked.**
pub fn decode_untrusted_finalized(payload: &[u8]) -> Result<Finalized, Error> {
    bounded(payload)
}

/// Decodes a bare alto block.
///
/// A block carries no certificate, so there is nothing here that verification
/// could add: a block is only ever as trustworthy as the certificate that
/// arrived with it.
pub fn decode_untrusted_block(payload: &[u8]) -> Result<Block, Error> {
    bounded(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_payloads_are_rejected_before_decoding() {
        let payload = vec![0u8; MAX_PAYLOAD_LEN + 1];
        assert_eq!(
            decode_untrusted_seed(&payload),
            Err(Error::TooLarge {
                limit: MAX_PAYLOAD_LEN,
                actual: MAX_PAYLOAD_LEN + 1,
            })
        );
    }

    #[test]
    fn empty_payloads_are_truncated_not_panics() {
        assert_eq!(decode_untrusted_seed(&[]), Err(Error::Truncated));
        assert_eq!(decode_untrusted_block(&[]), Err(Error::Truncated));
    }
}
