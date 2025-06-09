import { Actor } from 'apify';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';

await Actor.init();

// Structure of input is defined in input_schema.json
const input = await Actor.getInput();
const { productName, category, site = 'amazon', maxResults = 10 } = input;

// Define site-specific configurations
const SITE_CONFIGS = {
    amazon: {
        searchUrl: (product, category) => 
            `https://www.amazon.com/s?k=${encodeURIComponent(product)}${category ? '&i=' + encodeURIComponent(category) : ''}`,
        selectors: {
            products: 'div[data-component-type="s-search-result"]',
            title: 'h2 a span',
            price: '.a-price .a-offscreen',
            rating: '.a-icon-star-small .a-icon-alt',
            image: 'img.s-image',
            link: 'h2 a.a-link-normal'
        }
    },
    shopee: {
        searchUrl: (product, category) => 
            `https://shopee.com.my/search?keyword=${encodeURIComponent(product)}${category ? '&categories=' + encodeURIComponent(category) : ''}`,
        selectors: {
            products: 'div[data-sqe="item"]',
            title: 'div[data-sqe="name"]',
            price: 'div[data-sqe="price"]',
            rating: 'div.shopee-rating-stars__stars',
            image: 'img[data-sqe="image"]',
            link: 'a[data-sqe="link"]'
        }
    }
    // Add more sites as needed
};

async function scrapeSite(siteConfig, product, category) {
    const searchUrl = siteConfig.searchUrl(product, category);
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };
    
    try {
        const response = await axios.get(searchUrl, { headers });
        const $ = cheerio.load(response.data);
        const products = [];
        
        $(siteConfig.selectors.products).slice(0, maxResults).each((i, element) => {
            const productElement = $(element);
            const title = productElement.find(siteConfig.selectors.title).text().trim();
            const price = productElement.find(siteConfig.selectors.price).text().trim();
            const rating = productElement.find(siteConfig.selectors.rating).text().trim();
            const image = productElement.find(siteConfig.selectors.image).attr('src');
            
            let link = productElement.find(siteConfig.selectors.link).attr('href');
            // Make sure links are absolute
            if (link && !link.startsWith('http')) {
                const urlObj = new URL(searchUrl);
                link = `${urlObj.origin}${link}`;
            }
            
            if (title) {
                products.push({
                    title,
                    price,
                    rating,
                    image,
                    link,
                    source: site
                });
            }
        });
        
        return products;
    } catch (error) {
        console.error(`Error scraping ${site}:`, error.message);
        return [];
    }
}

if (!productName && !category) {
    throw new Error('Please provide either a product name or category');
}

const siteConfig = SITE_CONFIGS[site.toLowerCase()];
if (!siteConfig) {
    throw new Error(`Unsupported site: ${site}. Supported sites are: ${Object.keys(SITE_CONFIGS).join(', ')}`);
}

const products = await scrapeSite(siteConfig, productName || '', category);

// Save products to Dataset
await Actor.pushData({
    query: {
        productName,
        category,
        site
    },
    results: products
});

await Actor.exit();