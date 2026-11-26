// OVELIO's own media store (Platform Engineering, Growth OS wave one). Files live in PostgreSQL (migration 070,
// bytea, at most 8 MB each), so uploads survive restarts, are part of the ovelio database backup, and work the same
// in the developer preview (embedded PGlite) and a hosted preview with DATABASE_URL.
//
// The type is decided from the file's bytes, never from the client: PNG, JPEG, GIF, WebP, PDF and SVG only. SVG is
// rebuilt from an allowlist of drawing elements with scripts, foreignObject, event handlers, javascript:/data: links
// and every external reference removed, and is served with `Content-Security-Policy: sandbox` as a second barrier.

import { createHash } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import type { MediaItem } from '@/contracts';
import { AppError } from './config';
import { db } from './db';

export const maxMediaBytes = 8 * 1024 * 1024;
export const mediaTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'image/svg+xml'] as const;
export type MediaType = (typeof mediaTypes)[number];

const extensions: Record<MediaType, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf', 'image/svg+xml': 'svg',
};

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) => signature.every((value, index) => bytes[offset + index] === value);
const ascii = (text: string) => [...text].map(char => char.charCodeAt(0));

/** Recognises a supported file from its leading bytes (its "magic number"). Returns null for anything else. */
export function sniffMediaType(bytes: Uint8Array): MediaType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  if (startsWith(bytes, ascii('%PDF-'))) return 'application/pdf';
  // SVG is text: an optional BOM, XML declaration, comments or doctype, then the <svg> root element.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 4096)).replace(/^﻿/, '');
  if (/^<svg[\s>/]/i.test(head.replace(svgProlog, ''))) return 'image/svg+xml';
  return null;
}

/** What may precede an SVG root: whitespace, the XML declaration, comments and a doctype (with an internal subset). */
const svgProlog = /^(?:\s|<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>)*/i;

const svgElements = [
  'svg', 'g', 'defs', 'title', 'desc', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'marker',
  'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix', 'feComposite', 'feFlood', 'feMerge', 'feMergeNode',
  'feDropShadow', 'feMorphology', 'switch', 'metadata',
];
/** Elements whose content is dropped with them, not kept as text. */
const droppedWithContent = ['script', 'style', 'foreignObject', 'iframe', 'object', 'embed', 'noscript', 'template', 'image', 'animate', 'set', 'animateTransform', 'animateMotion', 'a', 'video', 'audio', 'canvas', 'handler', 'listener'];
const referenceAttributes = new Set(['href', 'xlink:href', 'src', 'xml:base', 'action', 'formaction']);

function cleanAttributes(attributes: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, raw] of Object.entries(attributes)) {
    const key = name.toLowerCase();
    const value = String(raw);
    const flat = value.replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
    if (key.startsWith('on')) continue;
    if (/(javascript|vbscript|data):/.test(flat)) continue;
    // Internal references (#id) only: no external files, origins or data URLs.
    if (referenceAttributes.has(key) && !/^#[\w.:-]+$/.test(value.trim())) continue;
    if (/url\((?!['"]?#)/.test(flat) || flat.includes('@import') || flat.includes('expression(')) continue;
    kept[name] = value;
  }
  return kept;
}

/** Rebuilds an SVG from an allowlist of drawing elements; throws when nothing drawable is left. */
export function sanitizeSvg(svg: string): string {
  // The prolog goes first: a doctype can declare entities (external files, entity expansion).
  const cleaned = sanitizeHtml(svg.replace(/^﻿/, '').replace(svgProlog, ''), {
    parser: { xmlMode: true },
    allowedTags: svgElements,
    allowedAttributes: false,
    nonTextTags: droppedWithContent,
    allowedSchemes: [],
    allowProtocolRelative: false,
    allowVulnerableTags: false,
    transformTags: { '*': (tagName, attribs) => ({ tagName, attribs: cleanAttributes(attribs) }) },
  }).trim();
  if (!/^<svg[\s>]/.test(cleaned)) throw new AppError(400, 'That SVG has no drawing we can keep. Export it again as plain SVG.');
  return cleaned;
}

/** A safe file name for a download header and URL, with the extension of the detected type. */
export function mediaFilename(original: string, type: MediaType): string {
  const base = (original.split(/[\\/]/).pop() ?? '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const clean = base.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 100) || 'file';
  return `${clean}.${extensions[type]}`;
}

type MediaRow = { id: string; uuid: string; filename: string; content_type: MediaType; byte_size: number; sha256: string; created_at: Date };

function publicPath(row: Pick<MediaRow, 'uuid' | 'filename'>) {
  return `/media/${row.uuid}/${encodeURIComponent(row.filename)}`;
}

/** Absolute when APP_ORIGIN is set, so emails and pages on publishing domains load the file from the workspace. */
export function mediaUrl(row: Pick<MediaRow, 'uuid' | 'filename'>) {
  const origin = process.env.APP_ORIGIN;
  try {
    return origin ? new URL(publicPath(row), new URL(origin).origin).toString() : publicPath(row);
  } catch {
    return publicPath(row);
  }
}

function toItem(row: MediaRow): MediaItem {
  const url = mediaUrl(row);
  return {
    id: Number(row.id), uuid: row.uuid, filename: row.filename, contentType: row.content_type, url,
    thumbUrl: row.content_type.startsWith('image/') ? url : null, createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Validates, sniffs and stores an upload. The declared type is ignored; the bytes decide. */
export async function saveMedia(input: { filename: string; bytes: Uint8Array; uploadedBy?: string | null }): Promise<MediaItem> {
  if (!input.bytes.length) throw new AppError(400, 'Choose an image or PDF file to upload.');
  if (input.bytes.length > maxMediaBytes) throw new AppError(413, 'Upload a file smaller than 8 MB.');
  const type = sniffMediaType(input.bytes);
  if (!type) throw new AppError(400, 'Supported formats: PNG, JPEG, GIF, WebP, SVG and PDF. This file is none of them, whatever its name says.');
  let bytes = input.bytes;
  if (type === 'image/svg+xml') {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    bytes = new TextEncoder().encode(sanitizeSvg(text));
  }
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = await db.query<MediaRow>(
    `INSERT INTO media_files (filename, content_type, byte_size, sha256, bytes, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, uuid, filename, content_type, byte_size, sha256, created_at`,
    [mediaFilename(input.filename, type), type, buffer.length, createHash('sha256').update(buffer).digest('hex'), buffer, input.uploadedBy ?? null],
  );
  return toItem(result.rows[0]);
}

export async function listMedia(limit = 500): Promise<MediaItem[]> {
  const result = await db.query<MediaRow>(
    'SELECT id, uuid, filename, content_type, byte_size, sha256, created_at FROM media_files ORDER BY created_at DESC, id DESC LIMIT $1', [limit],
  );
  return result.rows.map(toItem);
}

/** True when the id belongs to this store (ids start at 1,000,000,000, above any engine's media ids). */
export async function deleteMedia(id: number): Promise<boolean> {
  const result = await db.query('DELETE FROM media_files WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}

export async function readMedia(uuid: string): Promise<{ filename: string; contentType: MediaType; bytes: Buffer; sha256: string } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) return null;
  const result = await db.query<{ filename: string; content_type: MediaType; bytes: Uint8Array; sha256: string }>(
    'SELECT filename, content_type, bytes, sha256 FROM media_files WHERE uuid = $1', [uuid],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { filename: row.filename, contentType: row.content_type, bytes: Buffer.from(row.bytes), sha256: row.sha256 };
}

/** Response headers for a stored file: its stored type, nosniff, a long cache, a sandbox for SVG, download for PDF. */
export function mediaHeaders(file: { filename: string; contentType: MediaType; bytes: Buffer; sha256: string }): Record<string, string> {
  const ascii = file.filename.replace(/[^\x20-\x7e]|"/g, '_');
  const headers: Record<string, string> = {
    'Content-Type': file.contentType,
    'Content-Length': String(file.bytes.length),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: `"${file.sha256}"`,
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Disposition': `${file.contentType === 'application/pdf' ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
  };
  if (file.contentType === 'image/svg+xml') headers['Content-Security-Policy'] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
  return headers;
}
