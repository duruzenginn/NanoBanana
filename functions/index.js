'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const cors = require('cors')({ origin: true });

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

			const allowedRatios = new Set(['1:1','16:9','9:16','3:2','2:3','4:3','3:4','5:4','4:5','21:9']);
			const ratio = typeof aspectRatio === 'string' && allowedRatios.has(aspectRatio) ? aspectRatio : undefined;

			const stylePrefix = style && typeof style === 'string' ? `Style: ${style}. ` : '';
			const fullPrompt = `${stylePrefix}${prompt}`.trim();

			const model = 'gemini-2.5-flash-image';
			const apiKey = process.env.GOOGLE_API_KEY;
			if (!apiKey) {
				return res.status(500).json({ error: 'Server is missing GOOGLE_API_KEY secret.' });
			}

			const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

			const body = {
				contents: [
					{
						role: 'user',
						parts: [{ text: fullPrompt }],
					},
				],
				generationConfig: {
					responseModalities: ['IMAGE'],
					...(ratio ? { imageConfig: { aspectRatio: ratio } } : {}),
				},
				// Optional: relax safety if your prompts are benign; default is fine
				// safetySettings: []
			};

			try {
				const resp = await fetch(url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				});

				if (!resp.ok) {
					const text = await resp.text();
					return res.status(502).json({ error: 'Upstream API error', status: resp.status, details: text });
				}

				const data = await resp.json();
				const candidates = data.candidates || [];
				if (!candidates.length) {
					const reason = data?.promptFeedback?.blockReason || 'NO_CANDIDATES';
					return res.status(400).json({ error: 'No image generated', reason, promptFeedback: data?.promptFeedback });
				}

				// Find first image part with inlineData
				let imgPart;
				for (const part of (candidates[0].content?.parts || [])) {
					if (part?.inlineData?.data) { imgPart = part; break; }
					if (part?.inline_data?.data) { imgPart = { inlineData: part.inline_data }; break; } // fallback for snake_case
				}

				if (!imgPart || !imgPart.inlineData?.data) {
					return res.status(400).json({ error: 'Model did not return an image.' });
				}

				const mimeType = imgPart.inlineData.mimeType || 'image/png';
				const imageBase64 = imgPart.inlineData.data;

				return res.status(200).json({ imageBase64, mimeType, modelVersion: data.modelVersion });
			} catch (err) {
				console.error('generateImage error:', err);
				return res.status(500).json({ error: 'Internal error generating image', details: String(err && err.message || err) });
			}
		});
	}
);
