import type { FieldInput, OptionColor } from "./schema";

/**
 * Built-in templates (D60). Static data, copied into a new collection's
 * schema through buildSchema, which assigns fresh field and option ids. There
 * is no template table and no link back: editing a collection never touches
 * its template.
 */
export type CollectionTemplate = { id: string; name: string; icon: string; description: string; fields: FieldInput[] };

const options = (...labels: Array<[string, OptionColor]>) =>
  labels.map(([label, color]) => ({ label, color }));

export const COLLECTION_TEMPLATES: readonly CollectionTemplate[] = [
  {
    id: "inventory",
    name: "Home inventory",
    icon: "package",
    description: "What you own, where it lives, and what it cost",
    fields: [
      { name: "Item", type: "text", required: true },
      { name: "Location", type: "select", options: options(["Kitchen", "orange"], ["Living room", "yellow"], ["Bedroom", "purple"], ["Garage", "gray"], ["Office", "blue"], ["Storage", "teal"]) },
      { name: "Quantity", type: "number", number: { decimals: 0, unit: "" } },
      { name: "Value", type: "number", number: { decimals: 2, unit: "" } },
      { name: "Purchased", type: "date" },
      { name: "Warranty until", type: "date" },
      { name: "Receipt", type: "file" },
      { name: "Notes", type: "text" }
    ]
  },
  {
    id: "subscriptions",
    name: "Subscriptions",
    icon: "credit-card",
    description: "Recurring payments and when they renew",
    fields: [
      { name: "Service", type: "text", required: true },
      { name: "Price", type: "number", number: { decimals: 2, unit: "" } },
      { name: "Billing", type: "select", options: options(["Monthly", "blue"], ["Yearly", "purple"], ["Weekly", "teal"]) },
      { name: "Next renewal", type: "date" },
      { name: "Category", type: "select", options: options(["Streaming", "red"], ["Software", "blue"], ["News", "gray"], ["Utilities", "yellow"], ["Other", "gray"]) },
      { name: "Active", type: "checkbox" },
      { name: "Website", type: "url" }
    ]
  },
  {
    id: "expenses",
    name: "Expenses",
    icon: "receipt",
    description: "Spending with categories and receipts",
    fields: [
      { name: "Description", type: "text", required: true },
      { name: "Amount", type: "number", number: { decimals: 2, unit: "" } },
      { name: "Date", type: "date" },
      { name: "Category", type: "select", options: options(["Food", "orange"], ["Transport", "blue"], ["Housing", "purple"], ["Health", "green"], ["Fun", "pink"], ["Other", "gray"]) },
      { name: "Paid by", type: "text" },
      { name: "Reimbursed", type: "checkbox" },
      { name: "Receipt", type: "file" }
    ]
  },
  {
    id: "recipes",
    name: "Recipes",
    icon: "chef-hat",
    description: "Dishes to cook, with tags and sources",
    fields: [
      { name: "Recipe", type: "text", required: true },
      { name: "Cuisine", type: "select", options: options(["Indian", "orange"], ["Italian", "green"], ["Mexican", "red"], ["Japanese", "pink"], ["Other", "gray"]) },
      { name: "Tags", type: "multi_select", options: options(["Quick", "teal"], ["Vegetarian", "green"], ["Dessert", "pink"], ["Batch cook", "purple"]) },
      { name: "Prep time", type: "number", number: { decimals: 0, unit: "min" } },
      { name: "Source", type: "url" },
      { name: "Ingredients", type: "text" },
      { name: "Steps", type: "text" },
      { name: "Made it", type: "checkbox" }
    ]
  },
  {
    id: "contacts",
    name: "Contacts",
    icon: "contact",
    description: "People, how to reach them, and related notes",
    fields: [
      { name: "Name", type: "text", required: true },
      { name: "Email", type: "text" },
      { name: "Phone", type: "text" },
      { name: "Group", type: "select", options: options(["Family", "pink"], ["Friends", "teal"], ["Work", "blue"], ["Neighbours", "green"]) },
      { name: "Birthday", type: "date" },
      { name: "Website", type: "url" },
      { name: "Related note", type: "note" },
      { name: "Notes", type: "text" }
    ]
  }
];

/** The schema of a collection created without a template or fields. */
export const DEFAULT_FIELDS: FieldInput[] = [{ name: "Name", type: "text" }, { name: "Notes", type: "text" }];

export const templateById = (id: string) => COLLECTION_TEMPLATES.find((template) => template.id === id) ?? null;
