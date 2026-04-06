const multer = require('multer');
const path = require('path');
const config = require('../config');

const ALLOWED_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv'
];

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

const validatedUpload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: config.maxFileSize },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const extOk = ALLOWED_EXTENSIONS.includes(ext);
    const mimeOk = ALLOWED_MIMES.includes(file.mimetype);

    if (!extOk) {
      return cb(new Error('Invalid file extension. Only .xlsx, .xls, and .csv files are allowed.'));
    }
    if (!mimeOk) {
      return cb(new Error('Invalid file type. Only Excel and CSV files are allowed.'));
    }

    cb(null, true);
  }
});

/**
 * Standalone validation function for testing.
 * @param {Object} file - A file object with originalname, mimetype, and size properties.
 * @returns {boolean} true if the file passes all validation checks.
 */
function validateUpload(file) {
  if (!file) return false;
  const ext = path.extname(file.originalname).toLowerCase();
  const extOk = ALLOWED_EXTENSIONS.includes(ext);
  const mimeOk = ALLOWED_MIMES.includes(file.mimetype);
  const sizeOk = file.size <= config.maxFileSize;
  return extOk && mimeOk && sizeOk;
}

module.exports = { validatedUpload, validateUpload, ALLOWED_MIMES, ALLOWED_EXTENSIONS };
