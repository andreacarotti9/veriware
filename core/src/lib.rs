//! Verify commonware threshold-simplex consensus certificates, natively or in a
//! browser.
//!
//! A threshold-simplex network is identified by two values: the namespace its
//! validators prefix to every signed message, and the threshold public key their
//! signatures recover to. Give veriware that pair and it will tell you whether a
//! seed, a notarization, or a finalization really came from that network.
//!
//! ```no_run
//! use veriware_core::Network;
//!
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! # let identity_bytes = [0u8; 96];
//! # let payload = [0u8; 0];
//! let network = Network::alto(&identity_bytes)?;
//! let finalized = network.verify_finalized(&payload)?;
//! println!("height {}", finalized.block.height);
//! # Ok(())
//! # }
//! ```
//!
//! # Trust boundary
//!
//! Every byte handed to this crate is treated as adversarial. Payloads are
//! length-capped before they are decoded, no path reachable from the public API
//! panics, and every failure is an [`Error`] with a stable [`Error::code`]. That
//! matters most in WebAssembly, where a panic poisons the module instance for the
//! rest of the page.
//!
//! # What this crate does not do
//!
//! It does not implement any cryptography. Verification is delegated to
//! [`alto_types`] and, through it, to `commonware-cryptography`; conformance is a
//! property of that delegation rather than of veriware's own correctness. It also
//! does not track chain state: verifying a finalization proves the certificate is
//! real, not that it is the newest one, and not that the network is live.

#![deny(missing_docs)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod decode;
mod error;
mod network;
pub mod view;
pub mod wasm;

pub use decode::{
    decode_untrusted_block, decode_untrusted_finalization, decode_untrusted_finalized,
    decode_untrusted_notarization, decode_untrusted_notarized, decode_untrusted_seed,
};
pub use error::Error;
pub use network::Network;

/// The alto certificate types, re-exported so callers need not depend on
/// `alto-types` directly.
pub use alto_types::{
    Block, Finalization, Finalized, Identity, Kind, Notarization, Notarized, Seed, EPOCH,
    NAMESPACE as ALTO_NAMESPACE,
};

/// Largest payload any entry point will decode, in bytes.
///
/// The largest thing veriware decodes is a certified block: a certificate (a
/// round and parent view as varints, a 32-byte digest, and two 48-byte
/// signatures) plus an alto block (a context, two more digests, and two more
/// varints). That tops out near 330 bytes. A kibibyte leaves room for varint
/// worst cases and for upstream to add a field, while still rejecting the class
/// of input that exists only to make a decoder allocate.
pub const MAX_PAYLOAD_LEN: usize = 1024;

/// Longest signing namespace a [`Network`] will accept, in bytes.
///
/// Namespaces are short protocol constants - alto's is five bytes. The cap is
/// here because the namespace is caller-supplied and gets hashed into every
/// verification.
pub const MAX_NAMESPACE_LEN: usize = 256;
