-- Let a logged meal contain barcode-scanned items.
--
-- A scanned item's macros come off the printed packet: not a USDA lookup, not
-- the model's estimate, and not typed in by hand. It is the most trustworthy
-- number this app can obtain, and collapsing it into 'user' would throw that
-- away -- every screen here answers "where did this number come from?", so the
-- provenance is the product, not a detail.

alter table public.meal_items drop constraint if exists meal_items_source_check;
alter table public.meal_items
  add constraint meal_items_source_check
    check (source in ('usda', 'llm', 'user', 'barcode'));

-- A meal logged purely by scanning had no photo and no note, so none of the
-- existing modes describe it honestly.
alter table public.meals drop constraint if exists meals_input_mode_check;
alter table public.meals
  add constraint meals_input_mode_check
    check (input_mode in ('photo', 'text', 'photo_text', 'barcode'));
