const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const employeesRoutes = require('./routes/employees.routes');
const documentsRoutes = require('./routes/documents.routes');
const leaveRoutes = require('./routes/leave.routes');
const loansRoutes = require('./routes/loans.routes');
const freelancersRoutes = require('./routes/freelancers.routes');
const workSubmissionsRoutes = require('./routes/workSubmissions.routes');
const contractsRoutes = require('./routes/contracts.routes');
const serviceAgreementsRoutes = require('./routes/serviceAgreements.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const auditLogRoutes = require('./routes/auditLog.routes');
const reportsRoutes = require('./routes/reports.routes');
const adminRoutes = require('./routes/admin.routes');
const companiesRoutes = require('./routes/companies.routes');

const app = express();

app.set('trust proxy', 1); // required on Render/Railway for correct req.ip behind their proxy

app.use(helmet());
app.use(cors({ origin: env.frontendOrigin, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// Global baseline rate limit; auth routes apply a tighter one of their own.
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

app.get('/health', (req, res) => res.json({ status: 'ok', env: env.nodeEnv }));

const v1 = express.Router();
v1.use('/auth', authRoutes);
v1.use('/employees', employeesRoutes);
v1.use('/documents', documentsRoutes);
v1.use('/leave', leaveRoutes);
v1.use('/loans', loansRoutes);
v1.use('/freelancers', freelancersRoutes);
v1.use('/work-submissions', workSubmissionsRoutes);
v1.use('/contracts', contractsRoutes);
v1.use('/service-agreements', serviceAgreementsRoutes);
v1.use('/notifications', notificationsRoutes);
v1.use('/audit-log', auditLogRoutes);
v1.use('/reports', reportsRoutes);
v1.use('/admin', adminRoutes);
v1.use('/companies', companiesRoutes);

app.use('/v1', v1);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
