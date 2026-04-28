// src/middleware/validate.js
const { validationResult } = require('express-validator');

/**
 * Run express-validator checks and short-circuit with 422 if any fail.
 */
function validate(checks) {
  return [
    ...checks,
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
      }
      next();
    },
  ];
}

module.exports = { validate };
