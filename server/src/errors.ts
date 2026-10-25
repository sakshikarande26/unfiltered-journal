export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toBody() {
    return { error: { code: this.code, message: this.message } };
  }
}
