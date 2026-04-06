/**
 * Parse pagination query parameters from a request.
 * @param {Object} req - Express request object
 * @param {number} [defaultLimit=50] - Default items per page
 * @param {number} [maxLimit=500] - Maximum allowed items per page
 * @returns {{ page: number, limit: number, offset: number }}
 */
function parsePagination(req, defaultLimit = 50, maxLimit = 500) {
  const page = Math.max(0, parseInt(req.query.page) || 0);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit) || defaultLimit));
  const offset = page * limit;
  return { page, limit, offset };
}

module.exports = { parsePagination };
