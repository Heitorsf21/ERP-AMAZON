-- Duas lojas juntas: o vínculo passa a ser do APARELHO de quem vinculou
-- (chaveiro assinado em cookie httpOnly), não mais do login. A tabela de
-- vínculo por login sai: com ela, qualquer pessoa com o login de uma loja
-- abria a outra. Backup (pg_dump) é feito pelo deploy antes desta migration.
DROP TABLE IF EXISTS "VinculoLoja";
