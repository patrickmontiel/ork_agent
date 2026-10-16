import { test } from "node:test";
import assert from "node:assert/strict";
import { buildToken, verifyToken, safeRedirect, signPart } from "../lib/auth/token.ts";

// Lo que se prueba aquí es lo que, si falla, deja entrar a quien no debe.

const SECRET = "secreto-de-prueba-suficientemente-largo";
const TTL = 15 * 60_000;

test("un token recién hecho se verifica", () => {
  const { token } = buildToken("a@b.mx", "/pay?merchant=x", SECRET, TTL);
  const v = verifyToken(token, SECRET);
  assert.ok(v.ok);
  assert.equal(v.payload.e, "a@b.mx");
  assert.equal(v.payload.r, "/pay?merchant=x");
});

test("el correo se normaliza a minúsculas", () => {
  const { token } = buildToken("  Patrick@Lessio.AI  ", "/pay", SECRET, TTL);
  const v = verifyToken(token, SECRET);
  assert.ok(v.ok);
  assert.equal(v.payload.e, "patrick@lessio.ai");
});

test("dos tokens del mismo correo son distintos", () => {
  const a = buildToken("a@b.mx", "/pay", SECRET, TTL).token;
  const b = buildToken("a@b.mx", "/pay", SECRET, TTL).token;
  assert.notEqual(a, b, "el nonce debe hacerlos únicos");
});

// ─── Manipulación ───────────────────────────────────────────────────────────

test("cambiar el payload invalida la firma", () => {
  const { token } = buildToken("victima@b.mx", "/pay", SECRET, TTL);
  const [, sig] = token.split(".");
  // Un atacante se reescribe como otro usuario pero conserva la firma vieja.
  const falso = Buffer.from(
    JSON.stringify({ e: "atacante@b.mx", r: "/pay", n: "x", x: Date.now() + TTL }),
  ).toString("base64url");
  const v = verifyToken(`${falso}.${sig}`, SECRET);
  assert.equal(v.ok, false);
});

test("otro secreto no verifica", () => {
  const { token } = buildToken("a@b.mx", "/pay", SECRET, TTL);
  assert.equal(verifyToken(token, "otro-secreto-igual-de-largo-1234").ok, false);
});

test("token sin firma, vacío o con basura se rechaza", () => {
  for (const t of ["", ".", "abc", "abc.", ".abc", "a.b.c"]) {
    assert.equal(verifyToken(t, SECRET).ok, false, `debió rechazar: "${t}"`);
  }
});

test("payload que no es JSON se rechaza aunque la firma cuadre", () => {
  const body = Buffer.from("no soy json").toString("base64url");
  const token = `${body}.${signPart(body, SECRET)}`;
  assert.equal(verifyToken(token, SECRET).ok, false);
});

test("payload sin email se rechaza aunque la firma cuadre", () => {
  const body = Buffer.from(JSON.stringify({ r: "/pay", x: Date.now() + TTL })).toString("base64url");
  const token = `${body}.${signPart(body, SECRET)}`;
  assert.equal(verifyToken(token, SECRET).ok, false);
});

// ─── Expiración ─────────────────────────────────────────────────────────────

test("un token vencido se rechaza, y se distingue de uno inválido", () => {
  const t0 = Date.now();
  const { token } = buildToken("a@b.mx", "/pay", SECRET, TTL, t0);
  const v = verifyToken(token, SECRET, t0 + TTL + 1);
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.reason, "expirado");
});

test("justo antes de vencer, sigue sirviendo", () => {
  const t0 = Date.now();
  const { token } = buildToken("a@b.mx", "/pay", SECRET, TTL, t0);
  assert.equal(verifyToken(token, SECRET, t0 + TTL - 1).ok, true);
});

// ─── Redirect abierto ───────────────────────────────────────────────────────
// Sin esto, un link con ?redirect=https://sitio-falso.mx llevaría al usuario
// ahí ya con la sesión abierta.

test("solo se permiten rutas internas", () => {
  assert.equal(safeRedirect("/pay?merchant=x"), "/pay?merchant=x");
  assert.equal(safeRedirect("/cuenta/mandatos"), "/cuenta/mandatos");
});

test("se rechaza cualquier salida a otro dominio", () => {
  const malos = [
    "https://sitio-falso.mx",
    "http://sitio-falso.mx",
    "//sitio-falso.mx",
    "///sitio-falso.mx",
    "/\\sitio-falso.mx",
    "javascript:alert(1)",
    "data:text/html,<script>",
    "pay",
    "",
  ];
  for (const m of malos) {
    assert.equal(safeRedirect(m), "/pay", `debió rechazar: "${m}"`);
  }
});

test("se rechazan saltos de línea (inyección de cabecera)", () => {
  assert.equal(safeRedirect("/pay\r\nLocation: https://sitio-falso.mx"), "/pay");
  assert.equal(safeRedirect("/pay\nSet-Cookie: x=1"), "/pay");
});

test("null y undefined caen al destino por defecto", () => {
  assert.equal(safeRedirect(null), "/pay");
  assert.equal(safeRedirect(undefined), "/pay");
});

test("el redirect malicioso tampoco sobrevive dentro del token", () => {
  const { token } = buildToken("a@b.mx", "https://sitio-falso.mx", SECRET, TTL);
  const v = verifyToken(token, SECRET);
  assert.ok(v.ok);
  assert.equal(v.payload.r, "/pay", "se saneó al construirlo, no solo al leerlo");
});
