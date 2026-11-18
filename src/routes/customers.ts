import { Router } from 'express';
import { supabase } from '../database';

const router = Router();

// GET all customers
router.get('/', async (req, res) => {
    try {
        const { data: customers, error } = await supabase
            .from('billing_customers')
            .select('*')
            .order('createdAt', { ascending: false });

        if (error) throw error;
        res.json(customers);
    } catch (error) {
        console.error('Fetch customers error:', error);
        res.status(500).json({ error: 'Failed to fetch customers' });
    }
});

// GET customer by ID with invoice history
router.get('/:id/history', async (req, res) => {
    try {
        const { id } = req.params;

        // Fetch customer
        const { data: customer, error: custErr } = await supabase
            .from('billing_customers')
            .select('*')
            .eq('_id', id)
            .maybeSingle();

        if (custErr) throw custErr;
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        // Fetch invoices for this customer either by customerId or matching phone/name in JSONB
        const { data: invoices, error: invErr } = await supabase
            .from('billing_invoices')
            .select('*')
            .order('date', { ascending: false });

        if (invErr) throw invErr;

        const customerInvoices = (invoices || []).filter((inv: any) => {
            if (inv.customerId && inv.customerId === id) return true;
            if (inv.customer) {
                if (customer.phone && inv.customer.phone === customer.phone) return true;
                if (customer.name && inv.customer.name?.toLowerCase() === customer.name.toLowerCase()) return true;
                if (customer.vehicleNumber && inv.customer.vehicleNumber?.toLowerCase() === customer.vehicleNumber.toLowerCase()) return true;
            }
            return false;
        });

        res.json({
            customer,
            invoices: customerInvoices
        });
    } catch (error) {
        console.error('Customer history error:', error);
        res.status(500).json({ error: 'Failed to fetch customer history' });
    }
});

// POST create or upsert customer
router.post('/', async (req, res) => {
    try {
        const { name, phone, email, address, gstNumber, vehicleNumber, vehicleModel } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Customer name is required' });
        }

        const { data: customer, error } = await supabase
            .from('billing_customers')
            .insert({
                name,
                phone: phone || null,
                email: email || null,
                address: address || '',
                gstNumber: gstNumber || null,
                vehicleNumber: vehicleNumber || null,
                vehicleModel: vehicleModel || null,
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(customer);
    } catch (error) {
        console.error('Create customer error:', error);
        res.status(500).json({ error: 'Failed to create customer' });
    }
});

// PUT update customer
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, email, address, gstNumber, vehicleNumber, vehicleModel } = req.body;

        const { data: customer, error } = await supabase
            .from('billing_customers')
            .update({
                name,
                phone,
                email,
                address,
                gstNumber,
                vehicleNumber,
                vehicleModel,
                updatedAt: new Date()
            })
            .eq('_id', id)
            .select()
            .maybeSingle();

        if (error) throw error;
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        res.json(customer);
    } catch (error) {
        console.error('Update customer error:', error);
        res.status(500).json({ error: 'Failed to update customer' });
    }
});

// DELETE customer
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('billing_customers')
            .delete()
            .eq('_id', id)
            .select();

        if (error) throw error;
        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        res.json({ message: 'Customer deleted successfully' });
    } catch (error) {
        console.error('Delete customer error:', error);
        res.status(500).json({ error: 'Failed to delete customer' });
    }
});

export default router;
