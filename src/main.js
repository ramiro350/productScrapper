import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// Enhanced debug setup
const debug = {
  log: (...args) => console.log('[DEBUG]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  request: (req) => {
    console.log(`[REQUEST] ${req.method} ${req.path}`);
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
  },
  response: (url, status, data) => {
    console.log(`[RESPONSE] ${url} - Status: ${status}`);
    if (data && data.length > 500) {
      console.log('Data (truncated):', data.substring(0, 500) + '...');
    } else {
      console.log('Data:', data);
    }
  }
};

const PORT = process.env.PORT || 3000;

const SITE_CONFIGS = {
    amazon: {
        searchUrl: (product, category) => 
            `https://www.amazon.com/s?k=${encodeURIComponent(product)}${category ? '&i=' + encodeURIComponent(category) : ''}`,
            selectors: {
                products: 'div.s-result-item[data-component-type="s-search-result"]',
                title: 'h2.a-size-medium span', // Simpler and works as long as h2 > span structure holds
                price: '.a-price:not(.a-text-price) .a-offscreen',
                rating: 'i.a-icon-star-small span.a-icon-alt',
                image: 'img.s-image',
                link: 'h2 a.a-link-normal'
            }
            
    },
    shopee: {
        searchUrl: (product, category) => 
            `https://shopee.com.my/search?keyword=${encodeURIComponent(product)}${category ? '&categories=' + encodeURIComponent(category) : ''}`,
        selectors: {
            products: 'row shopee-search-item-result__items',
            title: 'div line-clamp-2 break-words min-w-0 min-h-[2.5rem] text-sm',
            price: 'span font-medium text-base/5 truncate',
            rating: 'div text-shopee-black87 text-xs/sp14 flex-none',
            image: 'img inset-y-0 w-full h-full pointer-events-none object-contain absolute',
            link: 'h2 a.a-link-normal'
        }
        }

};

async function scrapeSite(siteConfig, product, category, maxResults = 10) {
    const searchUrl = siteConfig.searchUrl(product, category);
    debug.log('Scraping URL:', searchUrl);
    const baseUrls = {
        amazon: 'https://www.amazon.com',
        shopee: 'https://shopee.com.br'
      };

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Referer': 'https://www.google.com/',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'DNT': '1',
        'Upgrade-Insecure-Requests': '1'
    };

    try {
        const startTime = Date.now();
        const response = await axios.get(searchUrl, { 
            headers,
            validateStatus: () => true
        });
        
        debug.log(`Request took ${Date.now() - startTime}ms`);
        debug.log('Response status:', response.status);

        const $ = cheerio.load(response.data);
        const products = [];

        debug.log(`Found ${$(siteConfig.selectors.products).length} product containers`);

        $(siteConfig.selectors.products).slice(0, maxResults).each((i, element) => {
            const productElement = $(element);
            const title = productElement.find(siteConfig.selectors.title).text().trim();
            const price = productElement.find(siteConfig.selectors.price).text().trim();
            const rating = productElement.find(siteConfig.selectors.rating).text().trim();
            const image = productElement.find(siteConfig.selectors.image).attr('src');
            
            // Get the relative link first
            let relativeLink = productElement.find(siteConfig.selectors.link).attr('href');
            let fullLink = relativeLink;

            if (relativeLink && !relativeLink.startsWith('http')) {
            try {
                fullLink = new URL(relativeLink, baseUrls[siteConfig.name] || searchUrl).href;
            } catch (e) {
                debug.error('Error constructing URL:', e);
                fullLink = null;
            }
            }

            debug.log(`Product ${i+1}:`, { title, price, rating, link: fullLink });

            // if (title && fullLink) {
                products.push({
                    title,
                    price: price || 'Price not available',
                    rating: rating || 'No rating',
                    image: image || 'No image',
                    link: fullLink,
                    source: 'amazon'
                });
            // }
        });

        return products;
    } catch (error) {
        debug.error('Scrape error:', {
            message: error.message,
            url: searchUrl,
            stack: error.stack,
            response: error.response?.data
        });
        return [];
    }
}

// API endpoint
app.post('/api/scrape', async (req, res) => {
    debug.request(req);
    
    try {
        const { productName, category, site = 'amazon', maxResults = 10 } = req.body;

        if (!productName && !category) {
            return res.status(400).json({ error: 'Please provide either a product name or category' });
        }

        const siteConfig = SITE_CONFIGS[site.toLowerCase()];
        if (!siteConfig) {
            return res.status(400).json({ 
                error: `Unsupported site: ${site}`,
                supportedSites: Object.keys(SITE_CONFIGS)
            });
        }

        const products = await scrapeSite(siteConfig, productName || '', category, maxResults);
        debug.response(req.path, 200, products);

        res.json({
            query: { productName, category, site },
            results: products
        });
    } catch (error) {
        debug.error('API error:', error);
        res.status(500).json({ 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

app.listen(PORT, () => {
    debug.log(`Server running on port ${PORT}`);
});