/**
 * Placeholder handler for endpoints whose route/permission wiring is final (matches
 * api/API.md) but whose service-layer implementation hasn't been written yet.
 * Follow the pattern in services/leave.service.js or services/employees.service.js:
 * a plain async function doing db.query()/withTransaction(), called from a thin
 * controller, wired here with the exact requirePermission()/requireOwnershipOrScope()
 * already declared below.
 */
function notImplemented(moduleName) {
  return (req, res) => {
    res.status(501).json({
      error: {
        code: 'NOT_IMPLEMENTED',
        message: `${moduleName} is scaffolded (routing + permissions are live) but the service layer isn't written yet.`
      }
    });
  };
}

module.exports = { notImplemented };
