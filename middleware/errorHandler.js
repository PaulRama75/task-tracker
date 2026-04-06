function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function globalErrorHandler(err, req, res, next) {
  // File too large (multer LIMIT_FILE_SIZE)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum size is 10MB.' });
  }

  // File validation errors
  if (err.message && (err.message.includes('Invalid file') || err.message.includes('Only .xlsx'))) {
    return res.status(400).json({ error: err.message });
  }

  // Generic server error — log details, return generic message
  console.error(`[${new Date().toISOString()}] Error:`, err.message || err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { asyncHandler, globalErrorHandler };
