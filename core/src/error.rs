//! Typed failures.

use commonware_codec::Error as CodecError;

/// Everything that can go wrong on the way from bytes to a verified certificate.
///
/// Variants describe the input rather than this crate's internals, since the
/// same error reaches a browser page. [`Error::code`] is stable and part of the
/// public API on both the Rust and the JavaScript side; the `Display` message
/// is not.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The payload is longer than [`crate::MAX_PAYLOAD_LEN`]. Rejected before decoding.
    #[error("payload is {actual} bytes, over the {limit}-byte limit")]
    TooLarge {
        /// The cap that was exceeded.
        limit: usize,
        /// The length that was offered.
        actual: usize,
    },

    /// The namespace is longer than [`crate::MAX_NAMESPACE_LEN`].
    #[error("namespace is {actual} bytes, over the {limit}-byte limit")]
    NamespaceTooLarge {
        /// The cap that was exceeded.
        limit: usize,
        /// The length that was offered.
        actual: usize,
    },

    /// The identity is not a valid threshold public key for this scheme.
    #[error("identity is not a valid threshold public key")]
    InvalidIdentity,

    /// The payload ran out of bytes mid-field.
    #[error("payload ended before the value was complete")]
    Truncated,

    /// The payload decoded, but bytes were left over. Carries how many.
    #[error("payload has {0} trailing byte(s)")]
    TrailingBytes(usize),

    /// The payload is not a well-formed value of the requested kind.
    #[error("payload is not a well-formed certificate")]
    Malformed,

    /// The payload is well-formed but self-contradictory - for a certified block,
    /// the certificate attests to a payload digest other than the block's own.
    #[error("payload failed a consistency check")]
    Inconsistent,

    /// The certificate's signature bytes are not valid group elements, so there is
    /// nothing to check them against.
    #[error("certificate signature is not a valid group element")]
    InvalidCertificate,

    /// The certificate is well-formed but was not signed by this network.
    #[error("certificate was not signed by this network")]
    InvalidSignature,

    /// A framed message carried a kind byte that is not seed, notarization, or
    /// finalization.
    #[error("unknown certificate kind {0}")]
    UnknownKind(u8),
}

impl Error {
    /// A stable, machine-readable tag for this failure.
    ///
    /// These strings are the contract callers branch on. They never change
    /// meaning; a new failure mode gets a new tag.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::TooLarge { .. } => "too_large",
            Self::NamespaceTooLarge { .. } => "namespace_too_large",
            Self::InvalidIdentity => "invalid_identity",
            Self::Truncated => "truncated",
            Self::TrailingBytes(_) => "trailing_bytes",
            Self::Malformed => "malformed",
            Self::Inconsistent => "inconsistent",
            Self::InvalidCertificate => "invalid_certificate",
            Self::InvalidSignature => "invalid_signature",
            Self::UnknownKind(_) => "unknown_kind",
        }
    }
}

impl From<CodecError> for Error {
    /// Collapses upstream codec errors into veriware's vocabulary.
    ///
    /// Deliberately lossy: codec errors name upstream types and field paths, and
    /// those are not veriware's to promise. Only the distinctions a caller can act
    /// on survive.
    fn from(error: CodecError) -> Self {
        match error {
            CodecError::EndOfBuffer => Self::Truncated,
            CodecError::ExtraData(remaining) => Self::TrailingBytes(remaining),
            // The codec raises `Invalid` for every semantic check that runs after
            // the bytes parse, from "not a point on the curve" to "this
            // certificate is not for this block". Only the second is a distinct
            // thing a caller can act on, and upstream names the type it was
            // checking. If those names ever change, this degrades to `Malformed`
            // and the fixture suite says so.
            CodecError::Invalid("types::Notarized" | "types::Finalized", _) => Self::Inconsistent,
            _ => Self::Malformed,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codec_errors_map_to_stable_codes() {
        let cases = [
            (CodecError::EndOfBuffer, "truncated"),
            (CodecError::ExtraData(3), "trailing_bytes"),
            (
                CodecError::Invalid("types::Notarized", "msg"),
                "inconsistent",
            ),
            (
                CodecError::Invalid("types::Finalized", "msg"),
                "inconsistent",
            ),
            (CodecError::Invalid("G1", "Invalid"), "malformed"),
            (CodecError::InvalidVarint(9), "malformed"),
            (CodecError::InvalidLength(7), "malformed"),
            (CodecError::InvalidBool, "malformed"),
        ];
        for (codec, code) in cases {
            assert_eq!(Error::from(codec).code(), code);
        }
    }

    #[test]
    fn messages_do_not_leak_upstream_internals() {
        let leaky = CodecError::Invalid("types::Notarized", "Proof payload does not match block");
        let message = Error::from(leaky).to_string();
        assert!(!message.contains("types::Notarized"), "{message}");
    }
}
