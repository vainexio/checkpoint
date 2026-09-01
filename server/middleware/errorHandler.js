/** Wrap an async handler so a rejected promise reaches the error handler. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || (err.name === 'ValidationError' ? 400 : 500);

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    return res.status(409).json({ error: `That ${field} is already in use.` });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ error: 'Malformed identifier.' });
  }

  if (status >= 500) console.error(err);

  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on our end.' : err.message,
    ...(err.name === 'ValidationError' ? { details: Object.keys(err.errors || {}) } : {}),
  });
}
