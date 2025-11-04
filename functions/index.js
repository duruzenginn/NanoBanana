'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const cors = require('cors')({ origin: true });
const admin = require('firebase-admin');
const { randomUUID } = require('crypto');
try {
	if (!admin.apps.length) {
		// Try to read storageBucket from FIREBASE_CONFIG; fallback to <projectId>.appspot.com
		let storageBucket;
		try {
			const cfg = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : undefined;
			storageBucket = cfg && cfg.storageBucket ? cfg.storageBucket : undefined;
		} catch {}
		const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;

    	// Use the bucket from config as-is (supports new *.firebasestorage.app buckets). If absent, fallback to <projectId>.appspot.com
    	const storageBucketNormalized = storageBucket || (projectId ? `${projectId}.appspot.com` : undefined);
		admin.initializeApp({
			...(storageBucketNormalized ? { storageBucket: storageBucketNormalized } : {}),
		});
	}
} catch (e) {
	// ignore re-init in emulator hot-reload
}

// Define secret for Google AI Studio API key (Gemini API)
const GOOGLE_API_KEY = defineSecret('GOOGLE_API_KEY');
const FREEPIK_API_KEY = defineSecret('FREEPIK_API_KEY');

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
		region: 'europe-west1',
		timeoutSeconds: 30,
		memory: '256MiB',
		cors: true,
		secrets: [FREEPIK_API_KEY],
	},
	async (req, res) => {
		// Handle CORS preflight
		if (req.method === 'OPTIONS') {
			res.set('Access-Control-Allow-Origin', '*');
			res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
			res.set('Access-Control-Allow-Headers', 'Content-Type');
			return res.status(204).send('');
		}

		return cors(req, res, async () => {
			if (req.method !== 'GET') {
				return res.status(405).json({ error: 'Method not allowed. Use GET.' });
			}

					const q = (req.query.q || '').toString().trim();
					let page = parseInt((req.query.page || '1').toString(), 10) || 1;
					let limit = parseInt((req.query.limit || '24').toString(), 10) || 24;
			if (!q) return res.status(400).json({ error: 'Missing required query parameter: q' });

			if (!process.env.FREEPIK_API_KEY) {
				return res.status(500).json({ error: 'FREEPIK_API_KEY not configured on server' });
			}

			try {
						// Normalize page/limit bounds
						if (page < 1) page = 1;
						if (limit < 1) limit = 1;
						if (limit > 100) limit = 100;

						// Freepik stock content search endpoint
						const apiUrl = new URL('https://api.freepik.com/v1/resources');
						apiUrl.searchParams.set('term', q);
						apiUrl.searchParams.set('page', String(page));
						apiUrl.searchParams.set('limit', String(limit));
						// Optional params you can experiment with:
						// apiUrl.searchParams.set('sort', 'relevance');
						// apiUrl.searchParams.set('order', 'desc');
						// apiUrl.searchParams.set('filters', 'resource_type:psd'); // check docs for valid filters

						// Provide Accept-Language if available
						const acceptLang = req.headers['accept-language'] || 'en-US';

						// Add timeout to avoid hanging
						const controller = new AbortController();
						const timeout = setTimeout(() => controller.abort(), 15000);

						const fpResp = await fetch(apiUrl.toString(), {
							method: 'GET',
							headers: {
								'x-freepik-api-key': process.env.FREEPIK_API_KEY,
								'Accept': 'application/json',
								'Accept-Language': Array.isArray(acceptLang) ? acceptLang[0] : acceptLang,
							},
							signal: controller.signal,
						}).catch((e) => {
							if (e && e.name === 'AbortError') {
								return { ok: false, status: 504, text: async () => JSON.stringify({ message: 'Upstream timeout' }) };
							}
							throw e;
						});

						clearTimeout(timeout);

						const text = await fpResp.text();
				let json;
				try { json = text ? JSON.parse(text) : {}; } catch {
					json = { raw: text };
				}

				if (!fpResp.ok) {
							const msg = json?.message || json?.error || `Freepik API error (${fpResp.status})`;
							return res.status(fpResp.status || 502).json({ error: msg, details: json });
				}

				// Optionally normalize the response to only what's needed by the UI
				// Here we pass through the original payload so you can map on the client.
				return res.status(200).json(json);
			} catch (err) {
				console.error('freepikSearch error:', err);
				return res.status(500).json({ error: 'Failed to fetch from Freepik', details: String(err?.message || err) });
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
		region: 'europe-west1',
		timeoutSeconds: 120,
		memory: '1GiB',
		cors: true,
		secrets: [GOOGLE_API_KEY],
	},
	async (req, res) => {
		// Handle CORS preflight explicitly for some clients
		if (req.method === 'OPTIONS') {
			res.set('Access-Control-Allow-Origin', '*');
			res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
			res.set('Access-Control-Allow-Headers', 'Content-Type');
			return res.status(204).send('');
		}

		return cors(req, res, async () => {
			if (req.method !== 'POST') {
				return res.status(405).json({ error: 'Method not allowed. Use POST.' });
			}

			const { prompt, style, aspectRatio, mockupImageUrl } = req.body || {};
			if (!prompt || typeof prompt !== 'string') {
				return res.status(400).json({ error: 'Missing required field: prompt (string).' });
			}

			try {
				const { generateImageFlow } = await getFlows();
				const result = await generateImageFlow({ prompt, style, aspectRatio, mockupImageUrl });
				return res.status(200).json(result);
			} catch (err) {
				// Validation errors from zod should be treated as 400
				if (err && (err.name === 'ZodError' || err.issues)) {
					return res.status(400).json({ error: 'Invalid input', details: err.issues || String(err) });
				}
				console.error('generateImage error:', err);
				return res.status(500).json({ error: 'Internal error generating image', details: String((err && err.message) || err) });
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
				import('@genkit-ai/core'),
				import('genkit'),
				import('@genkit-ai/googleai'),
				import('@genkit-ai/firebase'),
				import('zod'),
			]);

			const { flow } = core;
			const { genkit } = genkitPkg;
			const { googleAI } = googleAIPkg;
			const { enableFirebaseTelemetry } = firebasePkg;
			const { z } = zodPkg;

			// Sanity log to surface missing API key during cold starts/emulator runs
			console.log('GOOGLE_API_KEY set?', !!process.env.GOOGLE_API_KEY);

			if (!process.env.GOOGLE_API_KEY) {
				// Throw early so endpoints can return a good error
				throw new Error('Missing GOOGLE_API_KEY secret for Genkit');
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
					name: 'hello',
					inputSchema: z.object({ name: z.string() }),
					outputSchema: z.object({ message: z.string() }),
				},
				async (input) => ({ message: `Hello, ${input.name}! Genkit is ready.` })
			);

			const allowedRatios = ['1:1','16:9','9:16','3:2','2:3','4:3','3:4','5:4','4:5','21:9'];

								const generateImageFlow = flow(
				{
					name: 'generateImage',
					inputSchema: z.object({
						prompt: z.string().min(1),
						style: z.string().optional(),
						aspectRatio: z.enum(allowedRatios).optional(),
										// Optional: selected mockup image URL to condition the generation (handled server-side)
										mockupImageUrl: z.string().url().optional(),
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
									async ({ prompt, style, aspectRatio, mockupImageUrl }) => {
						const stylePrefix = style ? `Style: ${style}. ` : '';
										const fullPrompt = `${stylePrefix}${prompt}`.trim();

										// Best-effort: If a mockup image URL is provided, try to fetch it and include as multimodal input.
										// If anything fails, we fallback to text-only generation.
										let imageInput = null;
										if (mockupImageUrl) {
											try {
												const r = await fetch(mockupImageUrl);
												const mimeType = r.headers.get('content-type') || 'image/jpeg';
												const buffer = Buffer.from(await r.arrayBuffer());
												const base64 = buffer.toString('base64');
												imageInput = { mimeType, base64 };
											} catch (e) {
												console.warn('Failed to fetch mockup image, proceeding without it:', e?.message || e);
											}
										}

						// Use Genkit to generate an image with Gemini 2.5 Flash Image
										let media, rawResponse;
																				if (imageInput) {
																					// Use Gemini image model for image+text editing with a reference image.
																					const dataUrl = `data:${imageInput.mimeType};base64,${imageInput.base64}`;
																					({ media, rawResponse } = await ai.generate({
																						model: googleAI.model('gemini-2.5-flash-image'),
																						prompt: [
																							{ text: fullPrompt },
																							{ media: { contentType: imageInput.mimeType, url: dataUrl } },
																						],
																						config: {
																							responseModalities: ['IMAGE'],
																							responseMimeType: 'image/png',
																							...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
																						},
																						output: { format: 'media' },
																					}));
																		}	else {
																		({ media, rawResponse } = await ai.generate({
																			model: googleAI.model('gemini-2.5-flash-image'),
																			prompt: fullPrompt,
																			config: {
																				responseModalities: ['IMAGE'],
																				...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
																			},
																			output: { format: 'media' },
																		}));
																	}

						// Genkit may return media as an array or a single object. Normalize it.
						const m = Array.isArray(media) ? media[0] : media;
						if (!m?.url) {
							console.error('generate: missing media in response', { media, rawResponse });
							throw new Error('Model did not return image media.');
						}

						// m.url is a data URL: data:<mime>;base64,<data>
						const dataUrl = m.url;
						const commaIdx = dataUrl.indexOf(',');
						const header = dataUrl.substring(0, commaIdx);
						const imageBase64 = dataUrl.substring(commaIdx + 1);
						const mimeTypeMatch = /data:(.*?);base64/.exec(header);
						const mimeType = (mimeTypeMatch && mimeTypeMatch[1]) || 'image/png';

										// Persist to Cloud Storage and Firestore
										const buffer = Buffer.from(imageBase64, 'base64');
										const ext = (mime => {
											if (mime === 'image/png') return 'png';
											if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
											if (mime === 'image/webp') return 'webp';
											return 'bin';
										})(mimeType);

											// Generate an id up front so Storage write doesn't depend on Firestore availability
										const id = randomUUID();
										const imagePath = `images/${id}.${ext}`;

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
																	console.warn(`Storage bucket not found. Skipping storage write. Attempted bucket: ${bucketName || '(default)'} `);
																} else {
																	file = bucket.file(imagePath);
																	await file.save(buffer, {
																		resumable: false,
																		contentType: mimeType,
																		metadata: { cacheControl: 'public, max-age=31536000' },
																	});
																}
															} catch (storageErr) {
																console.warn('Storage write skipped due to error:', storageErr?.message || storageErr);
																file = null;
															}

											// Optionally create a signed URL (1 year)
										let downloadUrl = null;
										if (file) {
											try {
												// Use a Date object for signed URL expiry to avoid format issues
												const [url] = await file.getSignedUrl({ action: 'read', expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365) });
												downloadUrl = url;
											} catch (e) {
												// If signed URL fails, continue without it and log the error for diagnostics.
												console.warn('getSignedUrl failed:', e?.message || e);
											}
										} else {
											console.warn('Skipping getSignedUrl because file was not written to Storage');
										}

													// Attempt to write Firestore metadata, but don't fail the whole request if Firestore isn't set up
																										try {
															const db = admin.firestore();
														await db.collection('images').doc(id).set({
															prompt,
															style: style || null,
															aspectRatio: aspectRatio || null,
																													mockupImageUrl: mockupImageUrl || null,
															mimeType,
															storagePath: imagePath,
															downloadUrl,
																modelVersion: rawResponse?.modelVersion || null,
															size: buffer.length,
															createdAt: admin.firestore.FieldValue.serverTimestamp(),
														});
													} catch (metaErr) {
														console.warn('Firestore metadata write skipped:', metaErr?.message || metaErr);
													}

											return { imageBase64, mimeType, modelVersion: rawResponse?.modelVersion, id, storagePath: imagePath, downloadUrl };
				}
			);

			return { helloFlow, generateImageFlow };
		})();
		return bootPromise;
	};
})();

/**
 * Genkit-backed hello flow (example)
 * POST /api/hello
 * Body: { name: string }
 * Returns: { message: string }
 */
exports.genkitHello = onRequest(
	{
		region: 'europe-west1',
		timeoutSeconds: 60,
		memory: '512MiB',
		cors: true,
		secrets: [GOOGLE_API_KEY],
	},
	async (req, res) => {
		// Handle CORS preflight
		if (req.method === 'OPTIONS') {
			res.set('Access-Control-Allow-Origin', '*');
			res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
			res.set('Access-Control-Allow-Headers', 'Content-Type');
			return res.status(204).send('');
		}

		return cors(req, res, async () => {
			if (req.method !== 'POST') {
				return res.status(405).json({ error: 'Method not allowed. Use POST.' });
			}

			const name = req.body?.name;
			if (!name || typeof name !== 'string') {
				return res.status(400).json({ error: 'Missing required field: name (string).' });
			}

			try {
				const { helloFlow } = await getFlows();
				const result = await helloFlow({ name });
				return res.status(200).json(result);
			} catch (err) {
				console.error('genkitHello error:', err);
				return res.status(500).json({ error: 'Internal error running Genkit flow', details: String((err && err.message) || err) });
			}
		});
	}
);
