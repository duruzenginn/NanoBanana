'use strict';
// Load local env variables when running in emulator/development.
// Will look for .env.local first, then .env. Safe in production (ignored if files absent).
try {
	require('dotenv').config({ path: '.env.local' });
	require('dotenv').config();
} catch (e) {
	// dotenv optional
}

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const cors = require("cors")({ origin: true });
const admin = require("firebase-admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { randomUUID } = require("crypto");
const JSZip = require("jszip");
try {
	if (!admin.apps.length) {
		// Artık her şey FIREBASE_CONFIG üzerinden otomatik gelecek
		admin.initializeApp();
	}
} catch (e) {
	// ignore re-init in emulator hot-reload
}

// Ortak Firestore ve Storage referansları:
const db = getFirestore();
const bucket = admin.storage().bucket();

// Define secret for Google AI Studio API key (Gemini API)
const GOOGLE_API_KEY = defineSecret("GOOGLE_API_KEY");
const FREEPIK_API_KEY = defineSecret("FREEPIK_API_KEY");

/**
 * Proxy search to Freepik API to keep API key server-side.
 * GET /api/freepik/search?q=<query>&page=<n>&limit=<n>
 * Returns: JSON response from Freepik (or a normalized subset if desired).
 *
 * According to Freepik API docs, stock content search uses:
 *   GET https://api.freepik.com/v1/resources?term=...&page=...&limit=...
 * with header: x-freepik-api-key: <API_KEY>
 */
exports.freepikSearch = onRequest(
	{
		region: "europe-west1",
		timeoutSeconds: 30,
		memory: "256MiB",
		cors: true,
		secrets: [FREEPIK_API_KEY],
	},
	async (req, res) => {
		// Handle CORS preflight
		if (req.method === "OPTIONS") {
			res.set("Access-Control-Allow-Origin", "*");
			res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
			res.set("Access-Control-Allow-Headers", "Content-Type");
			return res.status(204).send("");
		}

		return cors(req, res, async () => {
			if (req.method !== "GET") {
				return res.status(405).json({ error: "Method not allowed. Use GET." });
			}

			const q = (req.query.q || "").toString().trim();
			let page = parseInt((req.query.page || "1").toString(), 10) || 1;
			let limit = parseInt((req.query.limit || "24").toString(), 10) || 24;
			if (!q) return res.status(400).json({ error: "Missing required query parameter: q" });

			if (!process.env.FREEPIK_API_KEY) {
				return res.status(500).json({ error: "FREEPIK_API_KEY not configured on server" });
			}

			try {
				// Normalize page/limit bounds
				if (page < 1) page = 1;
				if (limit < 1) limit = 1;
				if (limit > 100) limit = 100;

				// Freepik stock content search endpoint
				const apiUrl = new URL("https://api.freepik.com/v1/resources");
				apiUrl.searchParams.set("term", q);
				apiUrl.searchParams.set("page", String(page));
				apiUrl.searchParams.set("limit", String(limit));
				// Optional params you can experiment with:
				// apiUrl.searchParams.set('sort', 'relevance');
				// apiUrl.searchParams.set('order', 'desc');
				// apiUrl.searchParams.set('filters', 'resource_type:psd'); // check docs for valid filters

				// Provide Accept-Language if available
				const acceptLang = req.headers["accept-language"] || "en-US";

				// Add timeout to avoid hanging
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 15000);

				// Normalize API key to avoid trailing whitespace or newlines from Secret Manager
				const apiKey = (process.env.FREEPIK_API_KEY || "").trim();
				const fpResp = await fetch(apiUrl.toString(), {
					method: "GET",
					headers: {
						// Freepik docs specify x-freepik-api-key; include Authorization as Bearer for compatibility
						"x-freepik-api-key": apiKey,
						Authorization: `Bearer ${apiKey}`,
						Accept: "application/json",
						"Accept-Language": Array.isArray(acceptLang) ? acceptLang[0] : acceptLang,
						"User-Agent": "NanoBanana/1.0 (+firebase-functions)",
					},
					signal: controller.signal,
				}).catch((e) => {
					if (e && e.name === "AbortError") {
						return { ok: false, status: 504, text: async () => JSON.stringify({ message: "Upstream timeout" }) };
					}
					throw e;
				});

				clearTimeout(timeout);

				const text = await fpResp.text();
				let json;
				try {
					json = text ? JSON.parse(text) : {};
				} catch {
					json = { raw: text };
				}

				if (!fpResp.ok) {
					const msg = json?.message || json?.error || `Freepik API error (${fpResp.status})`;
					return res.status(fpResp.status || 502).json({ error: msg, details: json });
				}

				// Optionally normalize the response to only what's needed by the UI
				// Apply temporary heuristic free filter if requested.
				const onlyFree = String(req.query.onlyFree || "").toLowerCase() === "true";
				if (onlyFree && Array.isArray(json?.data)) {
					console.log('[freepikSearch] onlyFree pre-count=', json.data.length);
					try {
						json.data = json.data.filter((item) => {
							if (!item || typeof item !== "object") return false;
							const url = (item.url || "").toString();
							if (!url) return false;
							if (url.includes("/premium-")) return false; // exclude premium-marked URLs
							if (item.products && Array.isArray(item.products) && item.products.length > 0) return false; // has products => likely restricted
							if (url.includes("/free-")) return true; // heuristic keep
							// Relax heuristic: keep if no premium markers and no products (potentially free)
							return true;
						});
						console.log('[freepikSearch] onlyFree post-count=', json.data.length);
					} catch (e) {
						console.warn("onlyFree heuristic filtering error:", e?.message || e);
					}
				}
				// Here we pass through the original payload so you can map on the client.
				return res.status(200).json(json);
			} catch (err) {
				console.error("freepikSearch error:", err);
				return res.status(500).json({ error: "Failed to fetch from Freepik", details: String(err?.message || err) });
			}
		});
	}
);

/**
 * Proxy download to Freepik API to keep API key server-side.
 * GET /api/freepik/download?resourceId=<id>&variant=<optional>&filetype=<optional>
 * Returns: { downloadUrl: string | null, raw: any }
 */
exports.freepikDownload = onRequest(
	{
		region: "europe-west1",
		timeoutSeconds: 30,
		memory: "1GiB",
		cors: true,
		secrets: [FREEPIK_API_KEY],
	},
	async (req, res) => {
		// Handle CORS preflight
		if (req.method === "OPTIONS") {
			res.set("Access-Control-Allow-Origin", "*");
			res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
			res.set("Access-Control-Allow-Headers", "Content-Type");
			return res.status(204).send("");
		}

		return cors(req, res, async () => {
			if (req.method !== "GET") {
				return res.status(405).json({ error: "Method not allowed. Use GET." });
			}

			const resourceId = (req.query.resourceId || "").toString().trim();
			if (!resourceId) {
				return res.status(400).json({ error: "Missing required query parameter: resourceId" });
			}

			if (!process.env.FREEPIK_API_KEY) {
				return res.status(500).json({ error: "FREEPIK_API_KEY not configured on server" });
			}

			try {
				const apiUrl = new URL(`https://api.freepik.com/v1/resources/${encodeURIComponent(resourceId)}/download`);
				// Forward optional query params
				if (typeof req.query.variant !== "undefined" && req.query.variant !== null) {
					apiUrl.searchParams.set("variant", req.query.variant.toString());
				}
				if (typeof req.query.filetype !== "undefined" && req.query.filetype !== null) {
					apiUrl.searchParams.set("filetype", req.query.filetype.toString());
				}

				const acceptLang = req.headers["accept-language"] || "en-US";

				// Add timeout to avoid hanging
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 15000);

				const apiKey = (process.env.FREEPIK_API_KEY || "").trim();
				const fpResp = await fetch(apiUrl.toString(), {
					method: "GET",
					headers: {
						"x-freepik-api-key": apiKey,
						Authorization: `Bearer ${apiKey}`,
						Accept: "application/json",
						"Accept-Language": Array.isArray(acceptLang) ? acceptLang[0] : acceptLang,
						"User-Agent": "NanoBanana/1.0 (+firebase-functions)",
					},
					signal: controller.signal,
				}).catch((e) => {
					if (e && e.name === "AbortError") {
						return { ok: false, status: 504, text: async () => JSON.stringify({ message: "Upstream timeout" }) };
					}
					throw e;
				});

				clearTimeout(timeout);

				const text = await fpResp.text();
				let json;
				try {
					json = text ? JSON.parse(text) : {};
				} catch {
					json = { raw: text };
				}

				if (!fpResp.ok) {
					const msg = (json && (json.message || json.error)) || `Freepik API error (${fpResp.status})`;
					return res.status(fpResp.status || 502).json({ error: msg, details: json });
				}

				// Extract download URL from possible fields
				
				// Extract download URL from possible fields
				const downloadUrl =
				(json && (json.data?.url || json.url || json.location)) || null;

				if (!downloadUrl) {
				return res.status(502).json({
					error: "Missing download URL from Freepik response",
					raw: json,
				});
				}

				// --- Storage'a kaydet + Firestore'a yaz ---
				let storagePath = null;
				let signedUrl = null;
				let size = null;
				const id = randomUUID();

				try {
					const assetResp = await fetch(downloadUrl);
					if (!assetResp.ok) {
					console.warn(
						"Freepik asset fetch failed",
						assetResp.status,
						await assetResp.text().catch(() => "")
					);
					} else {
					const arrayBuffer = await assetResp.arrayBuffer();
					const zipBuffer = Buffer.from(arrayBuffer);
					size = zipBuffer.length;

					// 1) ZIP'i JSZip ile aç
					const zip = await JSZip.loadAsync(zipBuffer);

					// 2) İçindeki image dosyalarını filtrele (.png, .jpg, .jpeg, .webp)
					const allFiles = Object.values(zip.files); // JSZip file objeleri
					const imageFiles = allFiles.filter((file) => {
						if (file.dir) return false; // klasörleri at
						const name = file.name.toLowerCase();
						return (
						name.endsWith(".png") ||
						name.endsWith(".jpg") ||
						name.endsWith(".jpeg") ||
						name.endsWith(".webp")
						);
					});

					if (imageFiles.length === 0) { //optional silinebilir
						// İçinde image yoksa fallback: ZIP'i olduğu gibi kaydet
						console.warn("No image file found in Freepik ZIP, saving ZIP as-is");

						const ext = "zip";
						storagePath = `freepik/${id}.${ext}`;

						const file = bucket.file(storagePath);
						await file.save(zipBuffer, {
							resumable: false,
							contentType:
								assetResp.headers.get("content-type") || "application/zip",
							metadata: { cacheControl: "public, max-age=31536000" },
						});

						// Add Firebase download token so we can build a stable URL fallback
						let tokenUrl = null;
						try {
							const token = randomUUID();
							await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
							tokenUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
						} catch (metaErr) {
							console.warn("setMetadata token (zip) failed:", metaErr?.message || metaErr);
						}

						// Try Signed URL first; if it fails, fall back to token URL
						try {
							const [url] = await file.getSignedUrl({
								action: "read",
								expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
							});
							signedUrl = url || tokenUrl;
						} catch (e) {
							console.warn("getSignedUrl (zip) failed:", e?.message || e);
							signedUrl = tokenUrl;
						}

						// Firestore metadata (ZIP)
						try {
						await db.collection("freepikDownloads").doc(id).set({
							resourceId,
							storagePath,
							signedUrl,
							originalDownloadUrl: downloadUrl,
							mimeType: "application/zip",
							size,
							apiResponse: json,
							createdAt: FieldValue.serverTimestamp(),
						});
						} catch (metaErr) {
						console.warn(
							"Firestore metadata write failed (zip):",
							metaErr?.message || metaErr
						);
						}
	/*if (imageFiles.length === 0) {
  // Bu ZIP'in içinde bizim işimize yarayacak bir PNG/JPG/WEBP yok
  console.warn("No image file found in Freepik ZIP, skipping zip save", {
    resourceId,
    downloadUrl,
  });

  // Opsiyonel: sadece log amaçlı bir Firestore kaydı açabilirsin (storagePath yok)
  try {
    await db.collection("freepikDownloads").doc(id).set({
      resourceId,
      originalDownloadUrl: downloadUrl,
      mimeType: "application/zip",
      size: zipBuffer.length,
      apiResponse: json,
      hasImage: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (metaErr) {
    console.warn(
      "Firestore metadata write failed (no-image zip):",
      metaErr?.message || metaErr
    );
  }

  // Frontend'e bu resource'un kullanılabilir görseli olmadığını söyle
  return res.status(422).json({
    error: "NO_USABLE_IMAGE_IN_ZIP",
    message: "This Freepik resource does not contain a PNG/JPG/WEBP file in the ZIP.",
  });
} else {
  // BURASI AYNI KALSIN: image'i çıkarıp templates/<id>.jpg kaydettiğin kısım
  const mainImage = imageFiles[0];
  // ...
}
*/
					} else {
						// 3) Bir image seç (şimdilik: ilkini al)
						const mainImage = imageFiles[0];
						console.log("Using image from ZIP:", mainImage.name);

						// 4) Bu image'in içeriğini node Buffer olarak al
						const imgBuffer = await mainImage.async("nodebuffer");
						size = imgBuffer.length;

						// 5) Uzantı ve mime type belirle
						const name = mainImage.name.toLowerCase();
						let ext = "jpg";
						let mimeType = "image/jpeg";
						if (name.endsWith(".png")) {
						ext = "png";
						mimeType = "image/png";
						} else if (name.endsWith(".webp")) {
						ext = "webp";
						mimeType = "image/webp";
						} else if (name.endsWith(".jpg") || name.endsWith(".jpeg")) {
						ext = "jpg";
						mimeType = "image/jpeg";
						}

						// 6) Storage path: templates/<id>.<ext>
						storagePath = `templates/${id}.${ext}`;
						const file = bucket.file(storagePath);

						await file.save(imgBuffer, {
							resumable: false,
							contentType: mimeType,
							metadata: { cacheControl: "public, max-age=31536000" },
						});

						// Add Firebase download token so we can build a stable URL fallback
						let tokenUrl = null;
						try {
							const token = randomUUID();
							await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
							tokenUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
						} catch (metaErr) {
							console.warn("setMetadata token (image) failed:", metaErr?.message || metaErr);
						}

						// 7) Signed URL (artık gerçek image için) with fallback to token URL
						try {
							const [url] = await file.getSignedUrl({
								action: "read",
								expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
							});
							signedUrl = url || tokenUrl;
						} catch (e) {
							console.warn("getSignedUrl (image) failed:", e?.message || e);
							signedUrl = tokenUrl;
						}

						// 8) Firestore metadata (image)
						try {
						await db.collection("freepikDownloads").doc(id).set({
							resourceId,
							storagePath,
							signedUrl,
							originalDownloadUrl: downloadUrl,
							mimeType,
							size,
							imageFileName: mainImage.name,
							apiResponse: json,
							createdAt: FieldValue.serverTimestamp(),
						});
						} catch (metaErr) {
						console.warn(
							"Firestore metadata write failed (image):",
							metaErr?.message || metaErr
						);
						}
					}
					}
				} catch (assetErr) {
				console.warn(
					"Failed to cache Freepik asset to Storage:",
					assetErr?.message || assetErr
				);
				}

				// Frontend'in gerçekten kullanacağı cevap:
				return res.status(200).json({
				templateId: id,
				imageUrl: signedUrl, // şimdilik zip url, ama flow doğru
				storagePath,
				resourceId,
				});
			} catch (err) {
				console.error("freepikDownload error:", err);
				return res.status(500).json({ error: "Failed to download from Freepik", details: String(err?.message || err) });
			}
		});
	}
);

/**
 * Gen 2 HTTPS function: POST /api/generateImage
 * Body: { prompt: string, style?: string, aspectRatio?: '1:1'|'16:9'|'9:16'|'3:2'|'2:3'|'4:3'|'3:4'|'5:4'|'4:5'|'21:9' }
 * Returns: { imageBase64: string, mimeType: string, modelVersion?: string }
 */
exports.generateImageV2 = onRequest(
	{
		region: "europe-west1",
		timeoutSeconds: 120,
		memory: "1GiB",
		cors: true,
		secrets: [GOOGLE_API_KEY],
	},
	async (req, res) => {
		// Handle CORS preflight explicitly for some clients
		if (req.method === "OPTIONS") {
			res.set("Access-Control-Allow-Origin", "*");
			res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
			res.set("Access-Control-Allow-Headers", "Content-Type");
			return res.status(204).send("");
		}

		return cors(req, res, async () => {
			if (req.method !== "POST") {
				return res.status(405).json({ error: "Method not allowed. Use POST." });
			}

			const { prompt, style, aspectRatio, mockupImageUrl } = req.body || {};
			if (!prompt || typeof prompt !== "string") {
				return res.status(400).json({ error: "Missing required field: prompt (string)." });
			}

			try {
				const { generateImageFlow } = await getFlows();
				const result = await generateImageFlow({ prompt, style, aspectRatio, mockupImageUrl });
				return res.status(200).json(result);
			} catch (err) {
				// Validation errors from zod should be treated as 400
				if (err && (err.name === "ZodError" || err.issues)) {
					return res.status(400).json({ error: "Invalid input", details: err.issues || String(err) });
				}
				console.error("generateImage error:", err);
				return res.status(500).json({ error: "Internal error generating image", details: String((err && err.message) || err) });
			}
		});
	}
);

// Lazy Genkit bootstrap: configure once and expose flows for reuse.
const getFlows = (() => {
	let bootPromise;
	return async () => {
		if (bootPromise) return bootPromise;
		bootPromise = (async () => {
			// Dynamically import Genkit core, Google AI plugin, Firebase telemetry, and Zod
			const [core, genkitPkg, googleAIPkg, firebasePkg, zodPkg] = await Promise.all([
				import("@genkit-ai/core"),
				import("genkit"),
				import("@genkit-ai/googleai"),
				import("@genkit-ai/firebase"),
				import("zod"),
			]);

			const { flow } = core;
			const { genkit } = genkitPkg;
			const { googleAI } = googleAIPkg;
			const { enableFirebaseTelemetry } = firebasePkg;
			const { z } = zodPkg;

			// Sanity log to surface missing API key during cold starts/emulator runs
			console.log("GOOGLE_API_KEY set?", !!process.env.GOOGLE_API_KEY);

			if (!process.env.GOOGLE_API_KEY) {
				// Throw early so endpoints can return a good error
				throw new Error("Missing GOOGLE_API_KEY secret for Genkit");
			}

			// Initialize Genkit telemetry (required for flows) using Firebase integration.
			enableFirebaseTelemetry();

			// Initialize a Genkit instance with Google AI plugin. It will pick up GOOGLE_API_KEY automatically.
			const ai = genkit({
				plugins: [googleAI()],
				// Default model here is optional; we set it explicitly in generate() below
			});

			const helloFlow = flow(
				{
					name: "hello",
					inputSchema: z.object({ name: z.string() }),
					outputSchema: z.object({ message: z.string() }),
				},
				async (input) => ({ message: `Hello, ${input.name}! Genkit is ready.` })
			);

			const allowedRatios = ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "21:9"];

			const generateImageFlow = flow(
				{
					name: "generateImage",
					inputSchema: z.object({
					prompt: z.string().min(1),
					style: z.string().optional(),
					aspectRatio: z.enum(allowedRatios).optional(),
					mockupImageUrl: z.string().url().optional(),
					templateId: z.string().optional(), // freepikDownload'tan gelen uuid
					cropRect: z
					 .object({
						x: z.number(),
						y: z.number(),
						width: z.number(),
						height: z.number(),
						})
						.optional(), // varsa crop bilgisi
					}),
					outputSchema: z.object({
						imageBase64: z.string(),
						mimeType: z.string(),
						modelVersion: z.string().optional(),
						id: z.string().optional(),
						storagePath: z.string().optional(),
						downloadUrl: z.string().nullable().optional(),
					}),
				},
				async ({ prompt, style, aspectRatio, mockupImageUrl, templateId, cropRect }) => {
					const stylePrefix = style ? `Style: ${style}. ` : "";
					const fullPrompt = `${stylePrefix}${prompt}`.trim();

					// Best-effort: If a mockup image URL is provided, try to fetch it and include as multimodal input.
					// If anything fails, we fallback to text-only generation.
					let imageInput = null;
					if (mockupImageUrl) {
						try {
							const r = await fetch(mockupImageUrl);
							const mimeType = r.headers.get("content-type") || "image/jpeg";
							const buffer = Buffer.from(await r.arrayBuffer());
							const base64 = buffer.toString("base64");
							imageInput = { mimeType, base64 };
						} catch (e) {
							console.warn("Failed to fetch mockup image, proceeding without it:", e?.message || e);
						}
					}

					// Use Genkit to generate an image with Gemini 2.5 Flash Image
					let media, rawResponse;
					if (imageInput) {
						// Use Gemini image model for image+text editing with a reference image.
						const dataUrl = `data:${imageInput.mimeType};base64,${imageInput.base64}`;
						({ media, rawResponse } = await ai.generate({
							model: googleAI.model("gemini-2.5-flash-image"),
							prompt: [{ text: fullPrompt }, { media: { contentType: imageInput.mimeType, url: dataUrl } }],
							config: {
								responseModalities: ["IMAGE"],
								responseMimeType: "image/png",
								...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
							},
							output: { format: "media" },
						}));
					} else {
						({ media, rawResponse } = await ai.generate({
							model: googleAI.model("gemini-2.5-flash-image"),
							prompt: fullPrompt,
							config: {
								responseModalities: ["IMAGE"],
								...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
							},
							output: { format: "media" },
						}));
					}

					// Genkit may return media as an array or a single object. Normalize it.
					const m = Array.isArray(media) ? media[0] : media;
					if (!m?.url) {
						console.error("generate: missing media in response", { media, rawResponse });
						throw new Error("Model did not return image media.");
					}

					// m.url is a data URL: data:<mime>;base64,<data>
					const dataUrl = m.url;
					const commaIdx = dataUrl.indexOf(",");
					const header = dataUrl.substring(0, commaIdx);
					const imageBase64 = dataUrl.substring(commaIdx + 1);
					const mimeTypeMatch = /data:(.*?);base64/.exec(header);
					const mimeType = (mimeTypeMatch && mimeTypeMatch[1]) || "image/png";

					// Persist to Cloud Storage and Firestore
					const buffer = Buffer.from(imageBase64, "base64");
					
					const ext = ((mime) => {
						if (mime === "image/png") return "png";
						if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
						if (mime === "image/webp") return "webp";
						return "bin";
					})(mimeType);

					// Generate an id up front so Storage write doesn't depend on Firestore availability
					const id = randomUUID();
					const imagePath = `branded/${id}.${ext}`;

					// Attempt to persist to Cloud Storage. If the bucket isn't available (e.g., emulator not initialized)
					// do not fail the entire request — log and continue returning the imageBase64.
					const appOptions = admin.app().options || {};
					const configuredBucket = appOptions.storageBucket;
					const projId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
					const bucketName = configuredBucket || (projId ? `${projId}.appspot.com` : undefined);
					const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
					
					let file = null;
					try {
						const [bucketExists] = await bucket.exists();
						if (!bucketExists) {
							console.warn(`Storage bucket not found. Skipping storage write. Attempted bucket: ${bucketName || "(default)"} `);
						} else {
							file = bucket.file(imagePath);
							await file.save(buffer, {
								resumable: false,
								contentType: mimeType,
								metadata: { cacheControl: "public, max-age=31536000" },
							});
						}
					} catch (storageErr) {
						console.warn("Storage write skipped due to error:", storageErr?.message || storageErr);
						file = null;
					}

					// Optionally create a signed URL (1 year)
					let downloadUrl = null;
					if (file) {
						try {
							// Use a Date object for signed URL expiry to avoid format issues
							const [url] = await file.getSignedUrl({ action: "read", expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365) });
							downloadUrl = url;
						} catch (e) {
							// If signed URL fails, continue without it and log the error for diagnostics.
							console.warn("getSignedUrl failed:", e?.message || e);
						}
					} else {
						console.warn("Skipping getSignedUrl because file was not written to Storage");
					}

					// Attempt to write Firestore metadata, but don't fail the whole request if Firestore isn't set up
					try {
						
						await db.collection("images").doc(id).set({
						kind: "BRANDED",                  // istersen tag, ileride filtrelemek için
						prompt,
						style: style || null,
						aspectRatio: aspectRatio || null,
						mockupImageUrl: mockupImageUrl || null,
						mimeType,
						storagePath: imagePath,
						downloadUrl,
						modelVersion: rawResponse?.modelVersion || null,
						size: buffer.length,
						createdAt: FieldValue.serverTimestamp(), 

						// 🔹 İLİŞKİ ALANLARI:
						templateId: templateId || null,   // hangi Freepik template'ten türedi
						cropRect: cropRect || null,       // kullanıcı neresini crop'ladı
						});
					} catch (metaErr) {
						console.warn("Firestore metadata write skipped:", metaErr?.message || metaErr);
					}

					return { imageBase64, mimeType, modelVersion: rawResponse?.modelVersion, id, storagePath: imagePath, downloadUrl };
				}
			);

			return { helloFlow, generateImageFlow };
		})();
		return bootPromise;
	};
})();

// Firestore test endpoint
exports.testFirestoreWrite = onRequest(async (req, res) => {
	try {
		const docRef = await db.collection("testCollection").add({
			ok: true,
			createdAt: FieldValue.serverTimestamp(),
		});
		return res.status(200).json({ ok: true, id: docRef.id });
	} catch (e) {
		console.error("testFirestoreWrite error:", e);
		return res.status(500).json({ error: String(e.message || e) });
	}
});
