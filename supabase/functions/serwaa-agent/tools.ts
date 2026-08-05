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

// Tool schema filtering by caller role, per the permission matrix in
// docs/superpowers/specs/2026-08-03-staff-rbac-design.md §5.
//
// get_summary is the only restricted tool today: its response (see
// runReadTool() in src/lib/agent/readTools.ts) always bundles sales/profit
// *and* cash-in-hand/cash-in-bank into one spoken sentence — there is no
// column- or field-level split the way products.cost_price has one. The
// matrix draws two separate lines through that data:
//   - reports (profit, trends):     owner true, manager true,  staff false
//   - cashFlow (cash balance):      owner true, manager false, staff false
// Because get_summary cannot honor "profit yes, cash no" for Manager without
// being split into two tools, only a caller who is a "yes" on BOTH rows may
// be offered it — which today is Owner only. This intentionally goes further
// than filtering Staff alone: Manager loses get_summary too, matching the
// design doc's own stated intent ("Tool schema filtered by caller's role,
// e.g. no get_capital_summary tool for Staff/Manager" — that tool has since
// been consolidated into get_summary, but the Staff/Manager restriction it
// describes still applies to whatever tool carries cash data).
//
// Fails closed: any role that isn't the literal string 'owner' — including
// 'manager', 'staff', and null/undefined for an unresolved or unrecognized
// role — gets the restricted list, never the full one. An unresolvable role
// must never be treated as more trusted than a known-restricted one.
export function toolsForRole(role: string | null): typeof TOOLS[number][] {
  if (role === 'owner') return [...TOOLS]
  return TOOLS.filter((tool) => tool.name !== 'get_summary')
}
