import express from 'express';
import cors from 'cors';
import connectDB from './database';
import productRoutes from './routes/products';
import invoiceRoutes from './routes/invoices';
import customerRoutes from './routes/customers';
import warrantyRoutes from './routes/warranty';
import uploadRoutes from './routes/upload';

import dashboardRoutes from './routes/dashboard';
import authRoutes from './routes/auth';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Connect & setup DB
connectDB();

// Routes
app.use('/auth', authRoutes);
app.use('/products', productRoutes);
app.use('/invoices', invoiceRoutes);
app.use('/customers', customerRoutes);
app.use('/warranty', warrantyRoutes);
app.use('/upload', uploadRoutes);
app.use('/dashboard', dashboardRoutes);

app.get('/', (req, res) => {
    res.send('One Way Car Decors Billing API is running.');
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    // Server started
});
