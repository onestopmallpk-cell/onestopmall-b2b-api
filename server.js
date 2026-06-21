require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'onestopmall-pk';
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const B2B_API_KEY = process.env.B2B_API_KEY;
const PORT = process.env.PORT || 3000;

const SHOPIFY_BASE = `https://${SHOPIFY_STORE}.myshopify.com/admin/api/2026-04`;
const shopifyHeaders = {
  'X-Shopify-Access-Token': SHOPIFY_TOKEN,
  'Content-Type': 'application/json'
};

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key || key !== B2B_API_KEY) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized - Invalid API Key'
    });
  }
  next();
}

app.get('/', (req, res) => {
  res.json({
    name: 'OneStopMall B2B API',
    version: '2.0.0',
    store: 'www.onestopmall.pk',
    total_products: '3000+',
    contact: 'onestopmall.pk@gmail.com',
    endpoints: {
      all_products:     'GET /api/products?page=1&limit=250',
      all_products_max: 'GET /api/products/all (sare products ek baar mein)',
      single_product:   'GET /api/products/:id',
      search:           'GET /api/products/search?q=keyword',
      by_category:      'GET /api/products/category/:category',
      inventory:        'GET /api/inventory/:product_id',
      categories:       'GET /api/categories',
      create_order:     'POST /api/orders',
      order_status:     'GET /api/orders/:id'
    },
    authentication: 'Send x-api-key header with every request'
  });
});

// ================================================
// GET ALL PRODUCTS - WITH PAGINATION
// ================================================
app.get('/api/products', requireApiKey, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 250, 250);
    const page_info = req.query.page_info || null;
    const status = req.query.status || 'active';

    let url = `${SHOPIFY_BASE}/products.json?limit=${limit}&status=${status}`;
    if (page_info) url += `&page_info=${page_info}`;

    const response = await axios.get(url, { headers: shopifyHeaders });
    const products = response.data.products.map(p => formatProduct(p));

    // Next page info from headers
    const linkHeader = response.headers['link'] || '';
    let nextPageInfo = null;
    if (linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/page_info=([^&>]+)[^>]*>;\s*rel="next"/);
      if (match) nextPageInfo = match[1];
    }

    res.json({
      success: true,
      total_this_page: products.length,
      has_more: !!nextPageInfo,
      next_page_info: nextPageInfo,
      next_page_url: nextPageInfo
        ? `/api/products?page_info=${nextPageInfo}&limit=${limit}`
        : null,
      products: products
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================================================
// GET ALL PRODUCTS AT ONCE (SARE PRODUCTS)
// ================================================
app.get('/api/products/all', requireApiKey, async (req, res) => {
  try {
    let allProducts = [];
    let url = `${SHOPIFY_BASE}/products.json?limit=250&status=active`;
    let hasMore = true;

    while (hasMore) {
      const response = await axios.get(url, { headers: shopifyHeaders });
      const products = response.data.products;
      allProducts = allProducts.concat(products.map(p => formatProduct(p)));

      const linkHeader = response.headers['link'] || '';
      if (linkHeader.includes('rel="next"')) {
        const match = linkHeader.match(/page_info=([^&>]+)[^>]*>;\s*rel="next"/);
        if (match) {
          url = `${SHOPIFY_BASE}/products.json?limit=250&page_info=${match[1]}`;
        } else {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }

    res.json({
      success: true,
      total: allProducts.length,
      message: `All ${allProducts.length} products from OneStopMall`,
      products: allProducts
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================================================
// SEARCH PRODUCTS
// ================================================
app.get('/api/products/search', requireApiKey, async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ success: false, error: 'Query required' });
    const response = await axios.get(
      `${SHOPIFY_BASE}/products.json?title=${encodeURIComponent(query)}&status=active&limit=250`,
      { headers: shopifyHeaders }
    );
    const products = response.data.products.map(p => formatProduct(p));
    res.json({ success: true, query, total: products.length, products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================================================
// PRODUCTS BY CATEGORY
// ================================================
app.get('/api/products/category/:category', requireApiKey, async (req, res) => {
  try {
    const { category } = req.params;
    const response = await axios.get(
      `${SHOPIFY_BASE}/products.json?vendor=${encodeURIComponent(category)}&status=active&limit=250`,
      { headers: shopifyHeaders }
    );
    const products = response.data.products.map(p => formatProduct(p));
    res.json({ success: true, category, total: products.length, products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================================================
// SINGLE PRODUCT
// ================================================
app.get('/api/products/:id', requireApiKey, async (req, res) => {
  try {
    const response = await axios.get(
      `${SHOPIFY_BASE}/products/${req.params.id}.json`,
      { headers: shopifyHeaders }
    );
    res.json({ success: true, product: formatProduct(response.data.product) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================================================
// INVENTORY CHECK
// ================================================
app.get('/api/inventory/:product_id', requireApiKey, async (req, res) => {
  try {
    const response = await axios.get(
      `${SHOPIFY_BASE}/products/${req.params.product_id}.json`,
      { headers: shopifyHeaders }
    );
    const product = response.data.product;
    const variants = product.variants.map(v => ({
      variant_id: v.id,
      title: v.title,
      sku: v.sku,
      price: v.price,
      inventory: v.inventory_quantity,
      available: v.inventory_quantity > 0
    }));
    res.json({ success: true, product_title: product.title, variants });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================================================
// CATEGORIES
// ================================================
app.get('/api/categories', requireApiKey, async (req, res) => {
  try {
    const response = await axios.get(
      `${SHOPIFY_BASE}/custom_collections.json?limit=250`,
      { headers: shopifyHeaders }
    );
    const categories = response.data.custom_collections.map(c => ({
      id: c.id,
      title: c.title,
      handle: c.handle,
      image: c.image?.src || null
    }));
    res.json({ success: true, total: categories.length, categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================================================
// CREATE ORDER
// ================================================
app.post('/api/orders', requireApiKey, async (req, res) => {
  try {
    const { customer, line_items, note } = req.body;
    if (!customer || !line_items) {
      return res.status(400).json({ success: false, error: 'customer and line_items required' });
    }
    const orderData = {
      order: {
        line_items: line_items.map(i => ({ variant_id: i.variant_id, quantity: i.quantity })),
        customer: { first_name: customer.first_name, last_name: customer.last_name, email: customer.email, phone: customer.phone },
        shipping_address: { first_name: customer.first_name, last_name: customer.last_name, address1: customer.address, city: customer.city, country: 'PK', phone: customer.phone },
        note: note || 'B2B Order from imarkplace.com',
        tags: 'b2b,imarkplace',
        financial_status: 'pending'
      }
    };
    const response = await axios.post(`${SHOPIFY_BASE}/orders.json`, orderData, { headers: shopifyHeaders });
    const order = response.data.order;
    res.json({ success: true, order: { id: order.id, order_number: order.order_number, status: order.financial_status, total_price: order.total_price, currency: order.currency } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================================================
// ORDER STATUS
// ================================================
app.get('/api/orders/:id', requireApiKey, async (req, res) => {
  try {
    const response = await axios.get(`${SHOPIFY_BASE}/orders/${req.params.id}.json`, { headers: shopifyHeaders });
    const order = response.data.order;
    res.json({ success: true, order: { id: order.id, order_number: order.order_number, status: order.financial_status, fulfillment: order.fulfillment_status, total_price: order.total_price } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================================================
// FORMAT PRODUCT
// ================================================
function formatProduct(p) {
  return {
    id: p.id,
    title: p.title,
    description: p.body_html?.replace(/<[^>]*>/g, '') || '',
    vendor: p.vendor,
    product_type: p.product_type,
    tags: p.tags,
    status: p.status,
    url: `https://www.onestopmall.pk/products/${p.handle}`,
    images: p.images?.map(img => ({ id: img.id, src: img.src, alt: img.alt })) || [],
    variants: p.variants?.map(v => ({
      id: v.id,
      title: v.title,
      sku: v.sku,
      price: v.price,
      compare_price: v.compare_at_price,
      available: v.inventory_quantity > 0,
      inventory: v.inventory_quantity
    })) || [],
    created_at: p.created_at,
    updated_at: p.updated_at
  };
}

app.listen(PORT, () => {
  console.log(`OneStopMall B2B API v2.0 running on port ${PORT}`);
});
