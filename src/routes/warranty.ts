import { Router } from 'express';
import { supabase } from '../database';

const router = Router();

// GET all warranty claims
router.get('/', async (req, res) => {
    try {
        const { data: claims, error } = await supabase
            .from('billing_warranty_claims')
            .select('*')
            .order('claimedAt', { ascending: false });

        if (error) throw error;
        res.json(claims);
    } catch (error) {
        console.error('Fetch claims error:', error);
        res.status(500).json({ error: 'Failed to fetch warranty claims' });
    }
});

// GET verify warranty by invoiceNumber, vehicleNumber, or customer phone
router.get('/verify', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const trimmed = query.trim().toUpperCase();

        // 1. Fetch matching invoices
        const { data: invoices, error } = await supabase
            .from('billing_invoices')
            .select('*')
            .order('date', { ascending: false });

        if (error) throw error;

        // Filter invoices matching query
        const matchedInvoices = (invoices || []).filter((inv: any) => {
            const invNo = (inv.invoiceNumber || '').toUpperCase();
            const vehNo = (inv.customer?.vehicleNumber || '').toUpperCase();
            const phone = (inv.customer?.phone || '').toUpperCase();
            const name = (inv.customer?.name || '').toUpperCase();

            return invNo.includes(trimmed) || vehNo.includes(trimmed) || phone.includes(trimmed) || name.includes(trimmed);
        });

        // 2. Fetch all products to know their registered warranty periods
        const { data: products } = await supabase.from('billing_products').select('_id, name, "warrantyMonths"');
        const productMap = new Map();
        (products || []).forEach((p: any) => {
            productMap.set(p._id, p.warrantyMonths || 12);
            productMap.set(p.name?.toLowerCase(), p.warrantyMonths || 12);
        });

        // 3. Construct items with computed warranty status
        const verifiedItems: any[] = [];
        const now = new Date();

        matchedInvoices.forEach((inv: any) => {
            const invoiceDate = new Date(inv.date || inv.createdAt);

            (inv.items || []).forEach((item: any, idx: number) => {
                // Determine warranty duration
                let warrantyMonths = item.warrantyMonths;
                if (!warrantyMonths) {
                    if (item.productId && productMap.has(item.productId)) {
                        warrantyMonths = productMap.get(item.productId);
                    } else if (item.productName && productMap.has(item.productName.toLowerCase())) {
                        warrantyMonths = productMap.get(item.productName.toLowerCase());
                    } else {
                        warrantyMonths = 12; // default 12 months for car decors
                    }
                }

                // Calculate expiry
                const expiryDate = new Date(invoiceDate);
                expiryDate.setMonth(expiryDate.getMonth() + Number(warrantyMonths));

                const isValid = now <= expiryDate;
                const daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

                verifiedItems.push({
                    uniqueKey: `${inv._id}-${idx}`,
                    invoiceId: inv._id,
                    invoiceNumber: inv.invoiceNumber,
                    invoiceDate,
                    customerName: inv.customer?.name || 'Walk-in',
                    customerPhone: inv.customer?.phone || '',
                    vehicleNumber: inv.customer?.vehicleNumber || '',
                    vehicleModel: inv.customer?.vehicleModel || '',
                    productId: item.productId,
                    productName: item.productName,
                    quantity: item.quantity,
                    warrantyMonths,
                    warrantyExpiryDate: expiryDate,
                    isUnderWarranty: isValid,
                    daysRemaining: isValid ? daysRemaining : 0,
                    statusText: isValid ? 'UNDER WARRANTY' : 'EXPIRED'
                });
            });
        });

        res.json({
            count: verifiedItems.length,
            items: verifiedItems
        });
    } catch (error) {
        console.error('Verify warranty error:', error);
        res.status(500).json({ error: 'Failed to verify warranty' });
    }
});

// POST register a new warranty claim
router.post('/claim', async (req, res) => {
    try {
        const {
            invoiceNumber,
            invoiceDate,
            productId,
            productName,
            customerName,
            customerPhone,
            vehicleNumber,
            warrantyMonths,
            warrantyExpiryDate,
            issueDescription,
            actionTaken,
            notes
        } = req.body;

        if (!invoiceNumber || !productName || !issueDescription) {
            return res.status(400).json({ error: 'Invoice number, product, and issue description are required' });
        }

        const claimNumber = `CLM-${Date.now().toString().slice(-6)}`;

        const { data: claim, error } = await supabase
            .from('billing_warranty_claims')
            .insert({
                claimNumber,
                invoiceNumber,
                invoiceDate: invoiceDate || new Date(),
                productId: productId || null,
                productName,
                customerName: customerName || 'Valued Customer',
                customerPhone: customerPhone || null,
                vehicleNumber: vehicleNumber || null,
                warrantyMonths: Number(warrantyMonths) || 12,
                warrantyExpiryDate: warrantyExpiryDate || new Date(),
                issueDescription,
                actionTaken: actionTaken || 'Under Inspection',
                status: 'ACTIVE',
                claimedAt: new Date(),
                notes: notes || null
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(claim);
    } catch (error) {
        console.error('Warranty claim error:', error);
        res.status(500).json({ error: 'Failed to create warranty claim' });
    }
});

// PUT update warranty claim status / action taken
router.put('/claims/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, actionTaken, notes } = req.body;

        const updateData: any = {
            updatedAt: new Date()
        };
        if (status !== undefined) updateData.status = status;
        if (actionTaken !== undefined) updateData.actionTaken = actionTaken;
        if (notes !== undefined) updateData.notes = notes;
        if (status === 'RESOLVED' || status === 'REPLACED') {
            updateData.resolvedAt = new Date();
        }

        const { data: claim, error } = await supabase
            .from('billing_warranty_claims')
            .update(updateData)
            .eq('_id', id)
            .select()
            .maybeSingle();

        if (error) throw error;
        if (!claim) return res.status(404).json({ error: 'Claim not found' });

        res.json(claim);
    } catch (error) {
        console.error('Update claim error:', error);
        res.status(500).json({ error: 'Failed to update claim' });
    }
});

export default router;
