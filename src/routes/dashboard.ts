import { Router } from 'express';
import { supabase } from '../database';

const router = Router();

// GET dashboard stats
router.get('/stats', async (req, res) => {
    try {
        // 1. Total Revenue (Sum of grandTotal of all invoices)
        const { data: invoices, error: revError } = await supabase
            .from('billing_invoices')
            .select('grandTotal');

        if (revError) throw revError;
        const totalRevenue = invoices ? invoices.reduce((sum, inv) => sum + Number(inv.grandTotal), 0) : 0;

        // 2. Total Invoices Count
        const { count: totalInvoices, error: countInvError } = await supabase
            .from('billing_invoices')
            .select('*', { count: 'exact', head: true });

        if (countInvError) throw countInvError;

        // 3. Total Products Count
        const { count: totalProducts, error: countProdError } = await supabase
            .from('billing_products')
            .select('*', { count: 'exact', head: true });

        if (countProdError) throw countProdError;

        // 4. Total Customers Count
        const { count: totalCustomers, error: countCustError } = await supabase
            .from('billing_customers')
            .select('*', { count: 'exact', head: true });

        if (countCustError) throw countCustError;

        // 5. Total Warranty Claims Count & Active Claims
        const { data: claimsData } = await supabase
            .from('billing_warranty_claims')
            .select('status');
        
        const totalClaims = claimsData ? claimsData.length : 0;
        const activeClaims = claimsData ? claimsData.filter((c: any) => c.status === 'ACTIVE').length : 0;

        // 6. Recent Invoices (Limit 5)
        const { data: recentInvoices, error: recentError } = await supabase
            .from('billing_invoices')
            .select('_id, invoiceNumber, customer, grandTotal, createdAt')
            .order('createdAt', { ascending: false })
            .limit(5);

        if (recentError) throw recentError;

        // 7. Calculate Today's Sales and Month's Sales
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

        const { data: allInvoices } = await supabase
            .from('billing_invoices')
            .select('grandTotal, createdAt, date');

        let todaySales = 0;
        let monthSales = 0;
        const last7DaysMap: { [key: string]: number } = {};
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
            const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            last7DaysMap[dateStr] = 0;
        }

        (allInvoices || []).forEach((inv: any) => {
            const invTime = new Date(inv.date || inv.createdAt).getTime();
            const invAmt = Number(inv.grandTotal) || 0;
            if (invTime >= startOfToday) {
                todaySales += invAmt;
            }
            if (invTime >= startOfMonth) {
                monthSales += invAmt;
            }
            const invDateStr = new Date(invTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (last7DaysMap[invDateStr] !== undefined) {
                last7DaysMap[invDateStr] += invAmt;
            }
        });

        const salesTrends = Object.keys(last7DaysMap).map(day => ({
            date: day,
            sales: last7DaysMap[day]
        }));

        res.json({
            totalRevenue,
            todaySales,
            monthSales,
            totalInvoices: totalInvoices || 0,
            totalProducts: totalProducts || 0,
            totalCustomers: totalCustomers || 0,
            totalClaims,
            activeClaims,
            recentInvoices: recentInvoices || [],
            salesTrends
        });

    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});

export default router;
