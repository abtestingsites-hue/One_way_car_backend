import { Router } from 'express';
import { supabase } from '../database';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'fs';
import path from 'path';
import { logoBase64 } from './logo';

const router = Router();

// GET all invoices
router.get('/', async (req, res) => {
    try {
        const { data: invoices, error } = await supabase
            .from('billing_invoices')
            .select('*')
            .order('createdAt', { ascending: false });

        if (error) throw error;
        res.json(invoices);
    } catch (error) {
        console.error('Fetch invoices error:', error);
        res.status(500).json({ error: 'Failed to fetch invoices' });
    }
});

// POST create invoice
router.post('/', async (req, res) => {
    try {
        const { customer, items, date, customerId } = req.body;
        console.log('Received invoice request:', { customer, itemsCount: items?.length });

        if (!Array.isArray(items)) {
            return res.status(400).json({ error: 'Items must be an array' });
        }

        // If customer details are provided, ensure customer is stored/linked in billing_customers
        let linkedCustomerId = customerId || null;
        if (!linkedCustomerId && customer?.name) {
            try {
                // Check if customer exists by phone or name
                let query = supabase.from('billing_customers').select('_id');
                if (customer.phone) {
                    query = query.eq('phone', customer.phone);
                } else {
                    query = query.eq('name', customer.name);
                }
                const { data: existingCust } = await query.maybeSingle();

                if (existingCust) {
                    linkedCustomerId = existingCust._id;
                } else {
                    // Create customer record
                    const { data: newCust } = await supabase
                        .from('billing_customers')
                        .insert({
                            name: customer.name,
                            phone: customer.phone || null,
                            email: customer.email || null,
                            address: customer.address || '',
                            gstNumber: customer.gstNumber || null,
                            vehicleNumber: customer.vehicleNumber || null,
                            vehicleModel: customer.vehicleModel || null,
                        })
                        .select()
                        .single();

                    if (newCust) {
                        linkedCustomerId = newCust._id;
                    }
                }
            } catch (custErr) {
                console.warn('Customer upsert during invoice creation error:', custErr);
            }
        }

        // Calculate totals
        let subtotal = 0;
        let totalGst = 0;

        const invoiceItemsData = [];
        for (const item of items) {
            console.log('Processing item:', item.productId);
            
            // Find product by id (using UUID)
            const { data: product, error: productErr } = await supabase
                .from('billing_products')
                .select('*')
                .eq('_id', item.productId)
                .maybeSingle();

            if (productErr) throw productErr;

            if (product) {
                console.log('Found product:', product.name, 'Quantity:', product.quantity);
                const currentQty = product.quantity || 0;
                if (currentQty < item.quantity) {
                    console.error('Insufficient stock');
                    return res.status(400).json({ error: `Insufficient stock for ${product.name}` });
                }
                
                const updatedQty = currentQty - item.quantity;
                const inStock = updatedQty > 0;

                // Fix for legacy products missing productId
                let prodId = product.productId;
                if (!prodId) {
                    prodId = `PROD-${product._id.slice(-6).toUpperCase()}`;
                }

                // Update product in DB
                const { error: updateErr } = await supabase
                    .from('billing_products')
                    .update({
                        quantity: updatedQty,
                        inStock,
                        productId: prodId,
                        updatedAt: new Date()
                    })
                    .eq('_id', product._id);

                if (updateErr) throw updateErr;
                console.log('Product updated');
            } else {
                console.warn('Product not found for ID:', item.productId);
            }

            const base = item.quantity * item.unitPrice;
            const gst = base * (item.gstRate / 100);
            subtotal += base;
            totalGst += gst;
            invoiceItemsData.push({
                ...item,
                gstAmount: gst,
                totalAmount: base + gst,
            });
        }

        const grandTotal = subtotal + totalGst;
        const invoiceNumber = `INV-${Date.now()}`;

        const { data: invoice, error: insertErr } = await supabase
            .from('billing_invoices')
            .insert({
                invoiceNumber,
                date: date || new Date(),
                customerId: linkedCustomerId,
                customer, // JSONB
                items: invoiceItemsData, // JSONB
                subtotal,
                totalGst,
                grandTotal
            })
            .select()
            .single();

        if (insertErr) throw insertErr;
        res.status(201).json(invoice);

    } catch (error) {
        console.error('Error in POST /invoices:', error);
        res.status(500).json({ error: 'Failed to create invoice' });
    }
});

// GET PDF
router.get('/:id/pdf', async (req, res) => {
    let browser: any = null;
    try {
        const { id } = req.params;
        
        const { data: invoice, error: fetchErr } = await supabase
            .from('billing_invoices')
            .select('*')
            .eq('_id', id)
            .maybeSingle();

        if (fetchErr) throw fetchErr;
        if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

        // Load logo as base64 Data URI from the static module logo.ts
        const logoDataUri = logoBase64 ? `data:image/png;base64,${logoBase64}` : '';

        // HTML Template for PDF with Branding
        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&display=swap');
                body { font-family: 'Montserrat', sans-serif; padding: 40px; color: #111111; margin: 0; background: #ffffff; }
                .header { display: flex; justify-content: space-between; margin-bottom: 30px; border-bottom: 3px solid #E11D48; padding-bottom: 20px; align-items: center; }
                .logo-text { font-size: 28px; font-weight: 900; color: #09090b; letter-spacing: -0.5px; }
                .logo-accent { color: #E11D48; }
                .company-details { font-size: 11px; color: #52525b; margin-top: 5px; line-height: 1.4; }
                
                .invoice-title { font-size: 36px; font-weight: 900; color: #E11D48; text-align: right; letter-spacing: 1px; }
                .invoice-meta { text-align: right; margin-top: 8px; font-size: 13px; color: #27272a; }
                
                .details-grid { display: flex; gap: 20px; margin-top: 25px; }
                .bill-to { flex: 1; background: #f8fafc; border-left: 4px solid #E11D48; padding: 15px 18px; border-radius: 6px; }
                .bill-to h3 { margin: 0 0 8px 0; font-size: 12px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; }
                .bill-to p { margin: 3px 0; font-size: 13px; color: #18181b; }
                
                table { width: 100%; border-collapse: collapse; margin-top: 35px; }
                th { background-color: #09090b; color: #ffffff; padding: 12px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
                td { padding: 12px 10px; border-bottom: 1px solid #f1f5f9; font-size: 12px; color: #27272a; }
                tr:nth-child(even) { background-color: #f8fafc; }
                
                .totals { margin-top: 30px; margin-left: auto; width: 320px; }
                .total-row { display: flex; justify-content: space-between; padding: 7px 0; font-size: 13px; color: #3f3f46; }
                .grand-total { border-top: 2px solid #E11D48; margin-top: 8px; padding-top: 10px; font-weight: 800; font-size: 18px; color: #09090b; }
                
                .footer { margin-top: 50px; text-align: center; font-size: 11px; color: #71717a; border-top: 1px solid #e2e8f0; padding-top: 18px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <div class="logo-text">ONE WAY <span class="logo-accent">CAR DECORS</span></div>
                    <div class="company-details">
                        Premium Car Accessories, Styling, Audio & Detailing<br>
                        Main Road, Opp. Police Station<br>
                        Phone: +91 98765 43210 | GSTIN: ${invoice.customer?.gstNumber ? '33AAAFO1234F1Z1' : '33AAAFO1234F1Z1'}
                    </div>
                </div>
                <div>
                    <div class="invoice-title">TAX INVOICE</div>
                    <div class="invoice-meta">
                        <strong>Invoice #: ${invoice.invoiceNumber}</strong><br>
                        Date: ${new Date(invoice.date).toLocaleDateString()}
                    </div>
                </div>
            </div>

            <div class="details-grid">
                <div class="bill-to">
                    <h3>Customer & Vehicle Details</h3>
                    <p><strong>Name:</strong> ${invoice.customer?.name || 'Customer'}</p>
                    ${invoice.customer?.phone ? `<p><strong>Phone:</strong> ${invoice.customer.phone}</p>` : ''}
                    ${invoice.customer?.vehicleNumber ? `<p><strong>Vehicle No:</strong> <span style="background: #09090b; color: #ffffff; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${invoice.customer.vehicleNumber}</span></p>` : ''}
                    ${invoice.customer?.vehicleModel ? `<p><strong>Car Model:</strong> ${invoice.customer.vehicleModel}</p>` : ''}
                    ${invoice.customer?.address ? `<p><strong>Address:</strong> ${invoice.customer.address}</p>` : ''}
                    ${invoice.customer?.gstNumber ? `<p><strong>GSTIN:</strong> ${invoice.customer.gstNumber}</p>` : ''}
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Item Description</th>
                        <th>HSN/SAC</th>
                        <th>Qty</th>
                        <th>Rate (₹)</th>
                        <th>Taxable (₹)</th>
                        <th>GST %</th>
                        <th>GST Amt (₹)</th>
                        <th>Total (₹)</th>
                    </tr>
                </thead>
                <tbody>
                    ${invoice.items.map((item: any) => `
                    <tr>
                        <td><strong>${item.productName}</strong></td>
                        <td>${item.hsnCode || '-'}</td>
                        <td>${item.quantity}</td>
                        <td>${Number(item.unitPrice).toFixed(2)}</td>
                        <td>${(item.quantity * Number(item.unitPrice)).toFixed(2)}</td>
                        <td>${item.gstRate}%</td>
                        <td>${Number(item.gstAmount).toFixed(2)}</td>
                        <td>${Number(item.totalAmount).toFixed(2)}</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="totals">
                <div class="total-row">
                    <span>Taxable Amount:</span>
                    <span>₹${Number(invoice.subtotal).toFixed(2)}</span>
                </div>
                <div class="total-row">
                    <span>Total GST:</span>
                    <span>₹${Number(invoice.totalGst).toFixed(2)}</span>
                </div>
                <div class="total-row grand-total">
                    <span>Grand Total:</span>
                    <span style="color: #E11D48;">₹${Number(invoice.grandTotal).toFixed(2)}</span>
                </div>
            </div>

            <div class="footer">
                <p><strong>Thank you for choosing ONE WAY CAR DECORS! Drive Safe.</strong></p>
                <p>Computer-generated invoice. No signature required.</p>
            </div>
        </body>
        </html>
        `;

        let executablePath: string | null = null;
        let args: string[] = [];

        // Automatic OS-detection fallback
        if (process.platform === 'win32') {
            // Windows: Search standard Chrome locations locally
            const chromePaths = [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : null
            ].filter(Boolean) as string[];

            for (const p of chromePaths) {
                if (fs.existsSync(p)) {
                    executablePath = p;
                    console.log('Using local system Chrome for PDF generation:', p);
                    break;
                }
            }
            args = ['--no-sandbox', '--disable-setuid-sandbox'];
        } else {
            // Linux/Render: Use @sparticuz/chromium
            try {
                executablePath = await chromium.executablePath();
                args = chromium.args;
                console.log('Using @sparticuz/chromium for PDF generation on Render');
            } catch (err: any) {
                console.error('Failed to get @sparticuz/chromium executable path:', err);
            }
        }

        if (!executablePath) {
            throw new Error('Chromium/Chrome executable not found. Unable to render PDF.');
        }

        // Launch Browser
        browser = await puppeteer.launch({ 
            args,
            executablePath,
            headless: process.platform === 'win32' ? 'new' as any : true,
        });

        const page = await browser.newPage();
        await page.setContent(htmlContent);
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });

        // Close Browser
        await browser.close();
        browser = null; // Set to null so finally does not try to close it again

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Length': pdfBuffer.length,
            'Content-Disposition': `attachment; filename=invoice-${invoice.invoiceNumber}.pdf`
        });
        res.send(Buffer.from(pdfBuffer));

    } catch (error: any) {
        console.error('PDF Generation Error:', error);
        res.status(500).json({ error: `Failed to generate PDF: ${error.message || error}` });
    } finally {
        if (browser !== null) {
            try {
                await browser.close();
            } catch (closeErr) {
                console.error('Error closing browser in finally block:', closeErr);
            }
        }
    }
});

export default router;
