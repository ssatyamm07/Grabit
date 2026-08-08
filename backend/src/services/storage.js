import * as Minio from 'minio';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const FileType = require('file-type');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function extFromMime(mime) {
	const map = {
		'image/jpeg': 'jpg',
		'image/png': 'png',
		'image/webp': 'webp',
		'image/gif': 'gif',
	};
	return map[mime] || 'bin';
}

/**
 * S3-compatible object storage.
 * - Local: MinIO (docker compose)
 * - Prod: AWS S3 (set S3_ENDPOINT empty / STORAGE_DRIVER=s3 and AWS region)
 * - Tests: STORAGE_DRIVER=memory
 */
class ObjectStorage {
	constructor() {
		this.driver = (process.env.STORAGE_DRIVER || 'minio').toLowerCase();
		this.bucket = process.env.S3_BUCKET || process.env.MINIO_BUCKET_PRODUCTS || 'products';
		this.memory = new Map(); // key -> { buffer, contentType }
		this.ready = false;

		if (this.driver === 'memory') {
			this.baseUrl = process.env.S3_PUBLIC_URL || 'http://memory.local';
			this.ready = true;
			return;
		}

		const endPoint = process.env.S3_ENDPOINT || process.env.MINIO_ENDPOINT || '127.0.0.1';
		const port = Number(process.env.S3_PORT || process.env.MINIO_PORT || 9000);
		const useSSL =
			process.env.S3_USE_SSL === 'true' || process.env.MINIO_USE_SSL === 'true';
		const accessKey =
			process.env.S3_ACCESS_KEY ||
			process.env.MINIO_ACCESS_KEY ||
			process.env.AWS_ACCESS_KEY_ID ||
			'minioadmin';
		const secretKey =
			process.env.S3_SECRET_KEY ||
			process.env.MINIO_SECRET_KEY ||
			process.env.AWS_SECRET_ACCESS_KEY ||
			'minioadmin';

		// AWS S3: endPoint like s3.ap-south-1.amazonaws.com, port 443, useSSL true
		const isAws = this.driver === 's3' && !process.env.S3_ENDPOINT && !process.env.MINIO_ENDPOINT;
		this.client = new Minio.Client({
			endPoint: isAws
				? process.env.AWS_S3_ENDPOINT || `s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com`
				: endPoint,
			port: isAws ? 443 : port,
			useSSL: isAws ? true : useSSL,
			accessKey,
			secretKey,
			region: process.env.AWS_REGION || process.env.S3_REGION || 'us-east-1',
		});

		this.baseUrl =
			process.env.S3_PUBLIC_URL ||
			process.env.MINIO_PUBLIC_URL ||
			(isAws
				? `https://${this.bucket}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com`
				: `http://${endPoint}:${port}`);
	}

	async init() {
		if (this.driver === 'memory') {
			this.ready = true;
			return;
		}
		try {
			const exists = await this.client.bucketExists(this.bucket);
			if (!exists) {
				await this.client.makeBucket(this.bucket, process.env.S3_REGION || 'us-east-1');
				const policy = {
					Version: '2012-10-17',
					Statement: [
						{
							Effect: 'Allow',
							Principal: { AWS: ['*'] },
							Action: ['s3:GetObject'],
							Resource: [`arn:aws:s3:::${this.bucket}/*`],
						},
					],
				};
				await this.client.setBucketPolicy(this.bucket, JSON.stringify(policy));
				console.log(`Storage bucket created: ${this.bucket}`);
			}
			this.ready = true;
			console.log(`Storage ready (${this.driver}): ${this.bucket} @ ${this.baseUrl}`);
		} catch (err) {
			console.error('Storage init failed (uploads will error until MinIO/S3 is up):', err.message);
			this.ready = false;
		}
	}

	async detectContentType(buffer, fallbackMime, originalName = 'file.jpg') {
		try {
			const detected = await FileType.fromBuffer(buffer);
			if (detected?.mime) return detected.mime;
		} catch {
			/* ignore */
		}
		if (fallbackMime && ALLOWED_MIME.has(fallbackMime)) return fallbackMime;
		const ext = originalName.split('.').pop()?.toLowerCase();
		const byExt = {
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			png: 'image/png',
			webp: 'image/webp',
			gif: 'image/gif',
		};
		return byExt[ext] || 'application/octet-stream';
	}

	generateKey(originalName, prefix = 'products') {
		const ext = originalName.includes('.')
			? originalName.split('.').pop()
			: 'jpg';
		return `${prefix}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
	}

	publicUrl(key) {
		return `${this.baseUrl.replace(/\/$/, '')}/${this.bucket}/${key}`;
	}

	parseKeyFromUrl(url) {
		const u = new URL(url);
		const parts = u.pathname.split('/').filter(Boolean);
		// /bucket/key... or path-style
		if (parts[0] === this.bucket) {
			return parts.slice(1).join('/');
		}
		// virtual-host style: host is bucket.s3...
		return parts.join('/');
	}

	async uploadBuffer(buffer, { originalName = 'image.jpg', mimeType, prefix = 'products', metadata = {} } = {}) {
		if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
			return { success: false, error: 'Empty file' };
		}
		if (buffer.length > 5 * 1024 * 1024) {
			return { success: false, error: 'File too large (max 5MB)' };
		}

		const contentType = await this.detectContentType(buffer, mimeType, originalName);
		if (!ALLOWED_MIME.has(contentType)) {
			return { success: false, error: `Unsupported image type: ${contentType}` };
		}

		const safeName = originalName.replace(/[^\w.\-]+/g, '_') || `image.${extFromMime(contentType)}`;
		const key = this.generateKey(safeName, prefix);

		if (this.driver === 'memory') {
			this.memory.set(key, { buffer, contentType });
			return {
				success: true,
				url: this.publicUrl(key),
				key,
				bucket: this.bucket,
				contentType,
			};
		}

		if (!this.ready) {
			await this.init();
		}
		if (!this.ready) {
			return { success: false, error: 'Object storage unavailable' };
		}

		try {
			await this.client.putObject(this.bucket, key, buffer, buffer.length, {
				'Content-Type': contentType,
				...metadata,
			});
			return {
				success: true,
				url: this.publicUrl(key),
				key,
				bucket: this.bucket,
				contentType,
			};
		} catch (err) {
			console.error('uploadBuffer', err);
			return { success: false, error: err.message };
		}
	}

	async uploadBase64(base64String, originalName = 'image.jpg', prefix = 'products') {
		const cleaned = String(base64String).replace(/^data:image\/\w+;base64,/, '');
		const buffer = Buffer.from(cleaned, 'base64');
		return this.uploadBuffer(buffer, { originalName, prefix });
	}

	async deleteByUrl(url) {
		try {
			const key = this.parseKeyFromUrl(url);
			if (this.driver === 'memory') {
				this.memory.delete(key);
				return { success: true };
			}
			await this.client.removeObject(this.bucket, key);
			return { success: true };
		} catch (err) {
			console.error('deleteByUrl', err);
			return { success: false, error: err.message };
		}
	}
}

const storage = new ObjectStorage();
export default storage;
