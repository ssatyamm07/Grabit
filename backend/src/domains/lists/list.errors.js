export class ListError extends Error {
	constructor(code, message, status = 400, extra = {}) {
		super(message);
		this.code = code;
		this.status = status;
		this.extra = extra;
	}
}

export function toHttp(err) {
	if (err instanceof ListError) {
		return { status: err.status, body: { error: err.message, code: err.code, ...err.extra } };
	}
	return null;
}
