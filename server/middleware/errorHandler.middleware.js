export function errorHandler(error, _req, res, _next) {
  console.error(error.message);
  res.status(error.status || 500).json({
    message: error.status
      ? error.message
      : "An unexpected server error occurred.",
  });
}
