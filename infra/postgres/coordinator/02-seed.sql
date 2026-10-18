-- Static seed: the three branches and the node health rows.
-- (Demo coordinates only - used to pick the "nearest" branch.)
INSERT INTO branches (branch_id, code, name, city, latitude, longitude) VALUES
    (1, 'BR1', 'Central Library',     'Karachi', 24.8607, 67.0011),
    (2, 'BR2', 'North Campus Library','Karachi', 24.9400, 67.0800),
    (3, 'BR3', 'South Campus Library','Karachi', 24.8000, 67.0300);

INSERT INTO node_health (node_name, node_role, branch_id) VALUES
    ('coordinator',     'coordinator', NULL),
    ('branch1_primary', 'primary', 1),
    ('branch1_replica', 'replica', 1),
    ('branch2_primary', 'primary', 2),
    ('branch2_replica', 'replica', 2),
    ('branch3_primary', 'primary', 3),
    ('branch3_replica', 'replica', 3);
