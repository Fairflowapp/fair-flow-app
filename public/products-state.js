// products-state.js
// Shared mutable state for the Products catalog screen.
// Extracted from products.js (step 2 of the gradual split). The previous
// module-level `let` variables now live as fields on this single `pstate`
// object so that the future data/ui layers can share one source of truth.
// Initial values are byte-identical to the original declarations.

export const pstate = {
  productCategories: [],
  products: [],
  selectedCategoryId: null,
  selectedProductId: null,
  activeTab: "details",
  editorState: null,
  productsCatalogError: "",
  openProductCats: new Set(),
  productsSidebarRenderedOnce: false,
  _ffProdDragSrc: null,
  _ffProdDragHoverEl: null,
};
