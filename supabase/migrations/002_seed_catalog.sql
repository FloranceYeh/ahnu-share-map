insert into public.categories(id, label, color, sort_order) values
  ('food', '吃饭', '#ec7356', 10),
  ('coffee', '咖啡', '#d9a64d', 20),
  ('fun', '娱乐', '#63a47d', 30)
on conflict (id) do update set label = excluded.label, color = excluded.color, sort_order = excluded.sort_order;

insert into public.detail_fields(key, label, default_value, sort_order) values
  ('hours', '营业时间', '营业时间以店面为准', 10),
  ('price', '人均消费', '价格以店面为准', 20),
  ('bestFor', '适合', '随时去逛', 30)
on conflict (key) do update set label = excluded.label, default_value = excluded.default_value, sort_order = excluded.sort_order;
