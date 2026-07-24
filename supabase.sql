-- Ejecuta esto en Supabase: Project > SQL Editor > New query > pegar y "Run".
-- Crea una sola tabla con una sola fila que guarda todo el estado del negocio
-- (clientes, ventas, inventario, créditos, gastos, caja, billetera) como JSON.

create table if not exists movistar_data (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into movistar_data (id, data)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;

-- Row Level Security: como la app no tiene login (es de un solo usuario, tu negocio),
-- se habilita lectura/escritura pública con la anon key. Cualquiera con la URL de la
-- app podría ver/editar los datos si comparte el link — no compartas la URL públicamente.
-- Si más adelante quieres proteger esto con una contraseña, dímelo y lo agregamos.
alter table movistar_data enable row level security;

create policy "allow read" on movistar_data
  for select using (true);

create policy "allow insert" on movistar_data
  for insert with check (true);

create policy "allow update" on movistar_data
  for update using (true);
