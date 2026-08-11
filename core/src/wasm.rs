//! The JavaScript boundary.
//!
//! Nothing here throws. Every entry point returns a plain object shaped as
//! `{ ok: true, decoded }` or `{ ok: false, error: { code, message } }`, because
//! a `Result::Err` returned through `wasm_bindgen` becomes a thrown exception.
//!
//! The TypeScript package is the documented surface; these bindings are its
//! implementation detail and carry no stability promise of their own.

use crate::{decode, view, Error, Network};
use serde::Serialize;
use wasm_bindgen::prelude::*;

/// Serializer settings shared by every binding.
///
/// `u64` becomes `bigint`. Views, heights and timestamps are attacker-controlled
/// and pass `Number.MAX_SAFE_INTEGER` long before they exhaust `u64`.
fn serializer() -> serde_wasm_bindgen::Serializer {
    serde_wasm_bindgen::Serializer::new().serialize_large_number_types_as_bigints(true)
}

#[derive(Serialize)]
struct ErrorJs {
    code: &'static str,
    message: String,
}

#[derive(Serialize)]
struct OkJs<T> {
    ok: True,
    decoded: T,
}

#[derive(Serialize)]
struct ErrJs {
    ok: False,
    error: ErrorJs,
}

/// `true`, as a type, so the discriminant cannot drift.
struct True;

/// `false`, as a type.
struct False;

impl Serialize for True {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_bool(true)
    }
}

impl Serialize for False {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_bool(false)
    }
}

/// Renders a result as the tagged object the TypeScript wrapper expects.
///
/// A serialization failure is itself reported as an error outcome, so this
/// function has no failure mode of its own.
fn outcome<T: Serialize>(result: Result<T, Error>) -> JsValue {
    let rendered = match result {
        Ok(decoded) => OkJs { ok: True, decoded }.serialize(&serializer()),
        Err(error) => encode_error(error),
    };
    match rendered {
        Ok(value) => value,
        // Unreachable for these shapes, but a panic here would take the whole
        // module instance down with it.
        Err(_) => encode_error(Error::Malformed).unwrap_or(JsValue::NULL),
    }
}

fn encode_error(error: Error) -> Result<JsValue, serde_wasm_bindgen::Error> {
    ErrJs {
        ok: False,
        error: ErrorJs {
            code: error.code(),
            message: error.to_string(),
        },
    }
    .serialize(&serializer())
}

/// A network handle: a signing namespace and a threshold identity.
///
/// Build one with [`VeriwareNetwork::create`], which returns `undefined` rather
/// than throwing when the identity is not a valid public key.
#[wasm_bindgen(js_name = Network)]
pub struct VeriwareNetwork(Network);

#[wasm_bindgen(js_class = Network)]
impl VeriwareNetwork {
    /// Builds a network handle, or returns `undefined` if `identity` is not a
    /// valid threshold public key or `namespace` is too long.
    pub fn create(namespace: &[u8], identity: &[u8]) -> Option<VeriwareNetwork> {
        Network::new(namespace, identity).ok().map(Self)
    }

    /// Verifies a seed.
    pub fn verify_seed(&self, payload: &[u8]) -> JsValue {
        outcome(
            self.0
                .verify_seed(payload)
                .map(|seed| view::SeedView::from(&seed)),
        )
    }

    /// Verifies a bare notarization certificate.
    pub fn verify_notarization(&self, payload: &[u8]) -> JsValue {
        outcome(
            self.0
                .verify_notarization(payload)
                .and_then(|value| view::CertificateView::try_from(&value)),
        )
    }

    /// Verifies a bare finalization certificate.
    pub fn verify_finalization(&self, payload: &[u8]) -> JsValue {
        outcome(
            self.0
                .verify_finalization(payload)
                .and_then(|value| view::CertificateView::try_from(&value)),
        )
    }

    /// Verifies an alto notarization and the block it certifies.
    pub fn verify_notarized(&self, payload: &[u8]) -> JsValue {
        outcome(
            self.0
                .verify_notarized(payload)
                .and_then(|value| view::CertifiedBlockView::try_from(&value)),
        )
    }

    /// Verifies an alto finalization and the block it certifies.
    pub fn verify_finalized(&self, payload: &[u8]) -> JsValue {
        outcome(
            self.0
                .verify_finalized(payload)
                .and_then(|value| view::CertifiedBlockView::try_from(&value)),
        )
    }
}

/// Decodes a seed without verifying it.
#[wasm_bindgen]
pub fn decode_untrusted_seed(payload: &[u8]) -> JsValue {
    outcome(decode::decode_untrusted_seed(payload).map(|value| view::SeedView::from(&value)))
}

/// Decodes a bare notarization certificate without verifying it.
#[wasm_bindgen]
pub fn decode_untrusted_notarization(payload: &[u8]) -> JsValue {
    outcome(
        decode::decode_untrusted_notarization(payload)
            .and_then(|value| view::CertificateView::try_from(&value)),
    )
}

/// Decodes a bare finalization certificate without verifying it.
#[wasm_bindgen]
pub fn decode_untrusted_finalization(payload: &[u8]) -> JsValue {
    outcome(
        decode::decode_untrusted_finalization(payload)
            .and_then(|value| view::CertificateView::try_from(&value)),
    )
}

/// Decodes an alto notarization and its block without verifying either.
#[wasm_bindgen]
pub fn decode_untrusted_notarized(payload: &[u8]) -> JsValue {
    outcome(
        decode::decode_untrusted_notarized(payload)
            .and_then(|value| view::CertifiedBlockView::try_from(&value)),
    )
}

/// Decodes an alto finalization and its block without verifying either.
#[wasm_bindgen]
pub fn decode_untrusted_finalized(payload: &[u8]) -> JsValue {
    outcome(
        decode::decode_untrusted_finalized(payload)
            .and_then(|value| view::CertifiedBlockView::try_from(&value)),
    )
}

/// Decodes an alto block. Blocks carry no certificate, so there is nothing to verify.
#[wasm_bindgen]
pub fn decode_untrusted_block(payload: &[u8]) -> JsValue {
    outcome(decode::decode_untrusted_block(payload).map(|value| view::BlockView::from(&value)))
}
