import { tool } from "ai";
import { z } from "zod";
import {
  ApiRequestError,
  getCategories,
  getProductById,
  getProductStock,
  getProducts,
} from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { start } from "workflow/api";
import { returnFlow } from "./workflows/return-flow";

function errorMessage(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : "Unknown error";
}

export const searchProducts = tool({
  description: `Search the Vercel swag store product catalog. Use this whenever the user asks about products, what the store sells, or wants recommendations. Optionally narrow results to a single category. This is a broad lookup: it does not include live stock or every image. When the user asks about one specific item, call getProductDetails with an id or slug from these results.`,
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        `Optional free-text search terms describing what the user is looking for, e.g. 'hoodie' or 'water bottle'.`,
      ),
    category: z
      .string()
      .optional()
      .describe(
        `Optional category slug to filter results. Only set this when the user clearly wants a specific category. Use the getAllCategories tool to get all valid categories.`,
      ),
  }),
  execute: async ({ query, category }) => {
    "use step";
    try {
      const products = await getProducts({
        search: query,
        category,
        limit: 10,
      });
      return {
        count: products.length,
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          image: p.images[0],
          price: p.price,
          currency: p.currency,
          category: p.category,
          description: p.description,
        })),
      };
    } catch (err) {
      return { count: 0, products: [], error: errorMessage(err) };
    }
  },
});

export const getAllCategories = tool({
  description: `List every product category available in the Vercel swag store, along with the number of products in each. Use this when the user asks what categories exist, what kinds of products are sold, or wants to browse the store at a high level. Also call this before searchProducts when you need a valid category slug.`,
  inputSchema: z.object({}),
  execute: async () => {
    "use step";
    try {
      const categories = await getCategories();
      return {
        count: categories.length,
        categories: categories.map((c) => ({
          slug: c.slug,
          name: c.name,
          productCount: c.productCount,
        })),
      };
    } catch (err) {
      return { count: 0, categories: [], error: errorMessage(err) };
    }
  },
});

export const returnOrder = tool({
  description: `File a return for one of the user's past orders. The user must provide an order ID and a reason. Example order IDs: 11111, 22222, 33333.`,
  inputSchema: z.object({
    orderId: z.string().describe("The order ID the user wants to return."),
    reason: z
      .string()
      .min(10)
      .max(500)
      .describe("Why the user is returning the order."),
  }),
  execute: async ({ orderId, reason }) => {
    "use step";
    const run = await start(returnFlow, [orderId, reason]);
    return {
      runId: run.runId,
      message: `Return request received for order ${orderId}.`,
    };
  },
});

export const getProductDetails = tool({
  description: `Fetch one Ship It Shop product by id or slug, including the full description, every image, tags, and live stock. Use this when the user asks about a specific item (for example "tell me more about the black hoodie"). If you only have a product name, call searchProducts first and pass the matching id or slug here. Do not use this tool to browse or list the catalog.`,
  inputSchema: z.object({
    idOrSlug: z
      .string()
      .describe(
        "Product id or slug from searchProducts. The catalog API accepts either.",
      ),
  }),
  execute: async ({ idOrSlug }) => {
    "use step";
    try {
      const productPromise = getProductById(idOrSlug);
      const stockPromise = getProductStock(idOrSlug).then(
        (stock) => ({ ok: true as const, stock }),
        (err: unknown) => ({ ok: false as const, error: errorMessage(err) }),
      );
      const [product, stockResult] = await Promise.all([
        productPromise,
        stockPromise,
      ]);

      return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        description: product.description,
        price: product.price,
        priceDisplay: formatPrice(product.price, product.currency),
        currency: product.currency,
        category: product.category,
        images: product.images,
        tags: product.tags,
        featured: product.featured,
        path: `/products/${product.slug}`,
        stock: stockResult.ok
          ? {
              quantity: stockResult.stock.stock,
              inStock: stockResult.stock.inStock,
              lowStock: stockResult.stock.lowStock,
            }
          : null,
        stockError: stockResult.ok ? undefined : stockResult.error,
      };
    } catch (err) {
      return { error: errorMessage(err) };
    }
  },
});
