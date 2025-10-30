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

			const { prompt, style, aspectRatio } = req.body || {};
			if (!prompt || typeof prompt !== 'string') {
				return res.status(400).json({ error: 'Missing required field: prompt (string).' });
			}

			try {
				const { generateImageFlow } = await getFlows();
				const result = await generateImageFlow({ prompt, style, aspectRatio });
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
					async ({ prompt, style, aspectRatio }) => {
						const stylePrefix = style ? `Style: ${style}. ` : '';
						const fullPrompt = `${stylePrefix}${prompt}`.trim();

						// Use Genkit to generate an image with Gemini 2.5 Flash Image
						const { media, rawResponse } = await ai.generate({
							model: googleAI.model('gemini-2.5-flash-image'),
							prompt: fullPrompt,
							// Ask for image output and pass image config if provided
							config: {
								responseModalities: ['IMAGE'],
								...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
							},
							output: { format: 'media' },
						});

						if (!media?.url) {
							throw new Error('Model did not return image media.');
						}

						// media.url is a data URL: data:<mime>;base64,<data>
						const commaIdx = media.url.indexOf(',');
						const header = media.url.substring(0, commaIdx);
						const imageBase64 = media.url.substring(commaIdx + 1);
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

															// Ensure bucket exists before writing
															// Use the configured bucket (supports *.firebasestorage.app); fallback to <projectId>.appspot.com
															const appOptions = admin.app().options || {};
															const configuredBucket = appOptions.storageBucket;
															const projId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
															const bucketName = configuredBucket || (projId ? `${projId}.appspot.com` : undefined);
															const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
															const [bucketExists] = await bucket.exists();
															if (!bucketExists) {
																throw new Error(`Storage bucket not found. Please enable Firebase Storage in your project or set a valid storageBucket. Attempted bucket: ${bucketName || '(default)'} `);
															}
															const file = bucket.file(imagePath);
										await file.save(buffer, {
											resumable: false,
											contentType: mimeType,
											metadata: { cacheControl: 'public, max-age=31536000' },
										});

											// Optionally create a signed URL (1 year)
										let downloadUrl = null;
														try {
											const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 1000 * 60 * 60 * 24 * 365 });
											downloadUrl = url;
														} catch (e) {
											// If signed URL fails, continue without it.
										}

													// Attempt to write Firestore metadata, but don't fail the whole request if Firestore isn't set up
													try {
															const db = admin.firestore();
														await db.collection('images').doc(id).set({
															prompt,
															style: style || null,
															aspectRatio: aspectRatio || null,
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
