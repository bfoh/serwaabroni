// Anthropic tool definitions the model may call. Kept minimal and allow-listed.
export const TOOLS = [
  {
    name: 'add_sale',
    description: 'Record a cash or bank sale of one or more products the shop already stocks.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product: { type: 'string' },
              qty: { type: 'number' },
              unit: { type: 'string', description: 'The unit the buyer named, e.g. "box" or "sachet". Use the bigger pack unit when they buy a pack (e.g. "two boxes"); omit or use the small unit otherwise.' },
            },
            required: ['product', 'qty'],
          },
        },
        payment: { type: 'string', enum: ['cash', 'bank'] },
      },
      required: ['items'],
    },
  },
  {
    name: 'add_credit_sale',
    description: 'Record a sale taken on credit (pay later). Requires the customer name.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product: { type: 'string' },
              qty: { type: 'number' },
              unit: { type: 'string', description: 'The unit the buyer named, e.g. "box" or "sachet". Use the bigger pack unit when they buy a pack (e.g. "two boxes"); omit or use the small unit otherwise.' },
            },
            required: ['product', 'qty'],
          },
        },
        customer_name: { type: 'string' },
        due_date: { type: 'string', description: 'ISO date, optional' },
      },
      required: ['items', 'customer_name'],
    },
  },
  {
    name: 'new_product',
    description: 'Add a brand new product to the shop stock.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        cost_price: { type: 'number' },
        sell_price: { type: 'number' },
        qty: { type: 'number' },
        category: { type: 'string' },
        payment: { type: 'string', enum: ['cash', 'bank', 'supplier_credit'] },
      },
      required: ['name', 'cost_price', 'sell_price', 'qty'],
    },
  },
  {
    name: 'add_stock',
    description: 'Add more quantity to a product that already exists in the shop.',
    input_schema: {
      type: 'object',
      properties: {
        product: { type: 'string' },
        qty: { type: 'number' },
        cost_price: { type: 'number' },
      },
      required: ['product', 'qty'],
    },
  },
  {
    name: 'send_receipt',
    description:
      "Send a receipt for the sale that was just recorded to the buyer. Use only after a cash sale, when the user has given the buyer's name and phone number.",
    input_schema: {
      type: 'object',
      properties: {
        customer_name: { type: 'string' },
        customer_phone: { type: 'string', description: "The buyer's phone number" },
      },
      required: ['customer_phone'],
    },
  },
  { name: 'get_summary', description: "Get today's or a period's sales, profit, and cash.", input_schema: { type: 'object', properties: { period: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'] } } } },
  { name: 'get_low_stock', description: 'List products that are low or out of stock.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_debts', description: 'List who owes the shop or who the shop owes.', input_schema: { type: 'object', properties: { direction: { type: 'string', enum: ['owed', 'owing'] } } } },
  { name: 'get_top_products', description: 'List the shop products.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_alerts', description: 'Get current business alerts (low stock, overdue debts).', input_schema: { type: 'object', properties: {} } },
] as const
