// products.js
// Products barrel. The Products screen code was split by sub-topic into:
//   products-screen.js  (mobile drill-down, sidebar + DnD, detail render, navigation)
//   products-editor.js  (editor modal, confirm dialog, form wiring, Firestore CRUD)
// (products-helpers/state/data/ui were split earlier.)
// index.html keeps dynamic-importing this file; the public surface is unchanged
// and window.* hooks are assigned inside products-screen.js.

import { initProductsEditor } from "./products-editor.js?v=20260702_products_split";
import { renderProducts } from "./products-screen.js?v=20260702_products_split";

export * from "./products-screen.js?v=20260702_products_split";
export * from "./products-editor.js?v=20260702_products_split";

// Back-edge injection: the editor re-renders the screen after CRUD.
initProductsEditor({ renderProducts });
