import multer from 'multer';

const storage = multer.memoryStorage();

export const uploadImages = multer({
	storage,
	limits: { fileSize: 5 * 1024 * 1024, files: 8 },
	fileFilter: (_req, file, cb) => {
		if (file.mimetype?.startsWith('image/')) {
			cb(null, true);
		} else {
			cb(new Error('Only image files allowed'));
		}
	},
});
