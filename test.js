import FirecrawlApp from '@mendable/firecrawl-js';
import dotenv from 'dotenv';
dotenv.config();

const app = new FirecrawlApp({apiKey: process.env.FIRECRAWL_API_KEY});

// Scrape a website:
async function scrapeWebsite() {
  try {
    const scrapeResult = await app.scrapeUrl('firecrawl.dev', { formats: ['markdown', 'html'] });

    if (!scrapeResult.success) {
      throw new Error(`Failed to scrape: ${scrapeResult.error}`)
    }

    console.log(scrapeResult);
  } catch (error) {
    console.error("抓取错误:", error);
  }
}

scrapeWebsite();