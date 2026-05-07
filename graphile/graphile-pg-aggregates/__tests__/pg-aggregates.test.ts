import { join } from 'path';
import { getConnectionsObject, seed } from 'graphile-test';
import type { GraphQLQueryFnObj } from 'graphile-test';
import type { GraphileConfig } from 'graphile-config';
import { ConnectionFilterPreset } from 'graphile-connection-filter';
import { PgAggregatesPreset } from '../src';

const SCHEMA = 'agg_test';
const sqlFile = (f: string) => join(__dirname, '../sql', f);

type QueryFn = GraphQLQueryFnObj;

// Enable orderBy + groupBy + filterBy on all columns so aggregates work on
// non-FK columns too (mirrors what production schemas have via indexes/behaviors).
const EnableAllBehaviorsPlugin: GraphileConfig.Plugin = {
  name: 'EnableAllBehaviorsPlugin',
  version: '1.0.0',
  schema: {
    entityBehavior: {
      pgCodecAttribute: {
        inferred: {
          after: ['postInferred'],
          provides: ['enableAllBehaviors'],
          callback(behavior: any) {
            return [behavior, 'orderBy', 'filterBy', 'attribute:groupBy'];
          },
        },
      },
    },
  },
};

const testPreset = {
  extends: [
    ConnectionFilterPreset(),
    PgAggregatesPreset
  ],
  plugins: [EnableAllBehaviorsPlugin],
  schema: {
    connectionFilterRelations: true,
  },
};

// ============================================================================
// BASIC AGGREGATES
// ============================================================================
describe('Basic aggregates', () => {
  let teardown: () => Promise<void>;
  let query: QueryFn;

  beforeAll(async () => {
    const connections = await getConnectionsObject(
      {
        schemas: [SCHEMA],
        preset: testPreset,
        useRoot: true,
      },
      [seed.sqlfile([sqlFile('test-seed.sql')])]
    );

    teardown = connections.teardown;
    query = connections.query;
  });

  afterAll(async () => {
    if (teardown) await teardown();
  });

  it('sum aggregates numeric columns', async () => {
    const result = await query<{ allPlayers: { aggregates: { sum: { goals: string } } } }>({
      query: `
        query {
          allPlayers {
            aggregates {
              sum {
                goals
              }
            }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    // Total goals: 15+7+3+12+4+2+18+4+8+1 = 74
    expect(parseInt(result.data!.allPlayers.aggregates.sum.goals)).toBe(74);
  });

  it('average aggregates numeric columns', async () => {
    const result = await query<{ allPlayers: { aggregates: { average: { salary: string } } } }>({
      query: `
        query {
          allPlayers {
            aggregates {
              average {
                salary
              }
            }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    // Average salary: (90000+75000+65000+85000+70000+60000+95000+68000+72000+55000) / 10 = 73500
    expect(parseFloat(result.data!.allPlayers.aggregates.average.salary)).toBeCloseTo(73500, 0);
  });

  it('min and max aggregate numeric columns', async () => {
    const result = await query<{
      allPlayers: {
        aggregates: {
          min: { goals: string };
          max: { goals: string };
        };
      };
    }>({
      query: `
        query {
          allPlayers {
            aggregates {
              min { goals }
              max { goals }
            }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    expect(parseInt(result.data!.allPlayers.aggregates.min.goals)).toBe(1);
    expect(parseInt(result.data!.allPlayers.aggregates.max.goals)).toBe(18);
  });

  it('distinctCount aggregates', async () => {
    const result = await query<{
      allPlayers: {
        aggregates: {
          distinctCount: { position: string };
        };
      };
    }>({
      query: `
        query {
          allPlayers {
            aggregates {
              distinctCount { position }
            }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    // 3 distinct positions: Forward, Midfielder, Defender
    expect(parseInt(result.data!.allPlayers.aggregates.distinctCount.position)).toBe(3);
  });

  it('stddev and variance aggregates', async () => {
    const result = await query<{
      allPlayers: {
        aggregates: {
          stddevSample: { goals: string };
          varianceSample: { goals: string };
        };
      };
    }>({
      query: `
        query {
          allPlayers {
            aggregates {
              stddevSample { goals }
              varianceSample { goals }
            }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    expect(parseFloat(result.data!.allPlayers.aggregates.stddevSample.goals)).toBeGreaterThan(0);
    expect(parseFloat(result.data!.allPlayers.aggregates.varianceSample.goals)).toBeGreaterThan(0);
  });

  it('aggregates coexist with nodes and totalCount', async () => {
    const result = await query<{
      allPlayers: {
        totalCount: number;
        nodes: { name: string }[];
        aggregates: { sum: { goals: string } };
      };
    }>({
      query: `
        query {
          allPlayers {
            totalCount
            nodes { name }
            aggregates {
              sum { goals }
            }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    expect(result.data!.allPlayers.totalCount).toBe(10);
    expect(result.data!.allPlayers.nodes).toHaveLength(10);
    expect(parseInt(result.data!.allPlayers.aggregates.sum.goals)).toBe(74);
  });
});

// ============================================================================
// GROUPED AGGREGATES (GROUP BY)
// ============================================================================
describe('Grouped aggregates (groupBy)', () => {
  let teardown: () => Promise<void>;
  let query: QueryFn;

  beforeAll(async () => {
    const connections = await getConnectionsObject(
      {
        schemas: [SCHEMA],
        preset: testPreset,
        useRoot: true,
      },
      [seed.sqlfile([sqlFile('test-seed.sql')])]
    );

    teardown = connections.teardown;
    query = connections.query;
  });

  afterAll(async () => {
    if (teardown) await teardown();
  });

  it('groups players by position with aggregates', async () => {
    const result = await query<{
      allPlayers: {
        groupedAggregates: {
          keys: string[];
          sum: { goals: string };
        }[];
      };
    }>({
      query: `
        query {
          allPlayers {
            groupedAggregates(groupBy: [POSITION]) {
              keys
              sum { goals }
            }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    const groups = result.data!.allPlayers.groupedAggregates;
    expect(groups).toHaveLength(3); // Forward, Midfielder, Defender

    const forward = groups.find(g => g.keys[0] === 'Forward');
    expect(forward).toBeDefined();
    // Forwards: Alice(15) + Dave(12) + Grace(18) + Ivy(8) = 53
    expect(parseInt(forward!.sum.goals)).toBe(53);

    const defender = groups.find(g => g.keys[0] === 'Defender');
    expect(defender).toBeDefined();
    // Defenders: Carol(3) + Frank(2) + Jack(1) = 6
    expect(parseInt(defender!.sum.goals)).toBe(6);
  });

  it('groups players by team with sum of goals', async () => {
    const result = await query<{
      allPlayers: {
        groupedAggregates: {
          keys: string[];
          sum: { goals: string };
        }[];
      };
    }>({
      query: `
        query {
          allPlayers {
            groupedAggregates(groupBy: [TEAM_ID]) {
              keys
              sum { goals }
            }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    const groups = result.data!.allPlayers.groupedAggregates;
    expect(groups).toHaveLength(4); // 4 teams

    // Sort by team_id key to get predictable order
    const sorted = [...groups].sort((a, b) => parseInt(a.keys[0]) - parseInt(b.keys[0]));
    // Team 1 (Red Hawks): 15+7+3 = 25
    expect(parseInt(sorted[0].sum.goals)).toBe(25);
    // Team 2 (Blue Jays): 12+4+2 = 18
    expect(parseInt(sorted[1].sum.goals)).toBe(18);
    // Team 3 (Green Lions): 18+4 = 22
    expect(parseInt(sorted[2].sum.goals)).toBe(22);
    // Team 4 (Gold Eagles): 8+1 = 9
    expect(parseInt(sorted[3].sum.goals)).toBe(9);
  });

  it('groups matches by season with attendance average', async () => {
    const result = await query<{
      allMatches: {
        groupedAggregates: {
          keys: string[];
          average: { attendance: string };
          sum: { homeScore: string };
        }[];
      };
    }>({
      query: `
        query {
          allMatches {
            groupedAggregates(groupBy: [SEASON]) {
              keys
              average { attendance }
              sum { homeScore }
            }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    const groups = result.data!.allMatches.groupedAggregates;
    expect(groups).toHaveLength(2); // 2024 and 2025

    const season2024 = groups.find(g => g.keys[0] === '2024');
    expect(season2024).toBeDefined();
    // 2024 home scores: 3+2+1+4 = 10
    expect(parseInt(season2024!.sum.homeScore)).toBe(10);
  });
});

// ============================================================================
// HAVING (filter grouped aggregates)
// ============================================================================
describe('Having (filter grouped aggregates)', () => {
  let teardown: () => Promise<void>;
  let query: QueryFn;

  beforeAll(async () => {
    const connections = await getConnectionsObject(
      {
        schemas: [SCHEMA],
        preset: testPreset,
        useRoot: true,
      },
      [seed.sqlfile([sqlFile('test-seed.sql')])]
    );

    teardown = connections.teardown;
    query = connections.query;
  });

  afterAll(async () => {
    if (teardown) await teardown();
  });

  it('filters groups using having clause on sum', async () => {
    const result = await query<{
      allPlayers: {
        groupedAggregates: {
          keys: string[];
          sum: { goals: string };
        }[];
      };
    }>({
      query: `
        query {
          allPlayers {
            groupedAggregates(
              groupBy: [POSITION]
              having: { sum: { goals: { greaterThan: 10 } } }
            ) {
              keys
              sum { goals }
            }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    const groups = result.data!.allPlayers.groupedAggregates;
    // Forward: 53 goals (> 10) ✓
    // Midfielder: 15 goals (> 10) ✓
    // Defender: 6 goals (not > 10) ✗
    expect(groups).toHaveLength(2);
    const positions = groups.map(g => g.keys[0]).sort();
    expect(positions).toEqual(['Forward', 'Midfielder']);
  });

  it('filters groups using having clause on average', async () => {
    const result = await query<{
      allPlayers: {
        groupedAggregates: {
          keys: string[];
          average: { salary: string };
        }[];
      };
    }>({
      query: `
        query {
          allPlayers {
            groupedAggregates(
              groupBy: [POSITION]
              having: { average: { salary: { greaterThanOrEqualTo: "75000" } } }
            ) {
              keys
              average { salary }
            }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    const groups = result.data!.allPlayers.groupedAggregates;
    // Forward avg salary: (90000+85000+95000+72000)/4 = 85500 ✓
    // Midfielder avg salary: (75000+70000+68000)/3 = 71000 ✗
    // Defender avg salary: (65000+60000+55000)/3 = 60000 ✗
    expect(groups).toHaveLength(1);
    expect(groups[0].keys[0]).toBe('Forward');
  });
});

// ============================================================================
// RELATIONAL AGGREGATES (orderBy + filter)
// ============================================================================
describe('Relational aggregates', () => {
  let teardown: () => Promise<void>;
  let query: QueryFn;

  beforeAll(async () => {
    const connections = await getConnectionsObject(
      {
        schemas: [SCHEMA],
        preset: testPreset,
        useRoot: true,
      },
      [seed.sqlfile([sqlFile('test-seed.sql')])]
    );

    teardown = connections.teardown;
    query = connections.query;
  });

  afterAll(async () => {
    if (teardown) await teardown();
  });

  it('orders teams by sum of player goals (ascending)', async () => {
    const result = await query<{
      allTeams: {
        nodes: {
          name: string;
          playersByTeamId: { aggregates: { sum: { goals: string } } };
        }[];
      };
    }>({
      query: `
        query {
          allTeams(orderBy: PLAYERS_BY_TEAM_ID_SUM_GOALS_ASC) {
            nodes {
              name
              playersByTeamId {
                aggregates {
                  sum { goals }
                }
              }
            }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    const teams = result.data!.allTeams.nodes;
    expect(teams).toHaveLength(4);
    // Gold Eagles: 9, Blue Jays: 18, Green Lions: 22, Red Hawks: 25
    expect(teams[0].name).toBe('Gold Eagles');
    expect(teams[3].name).toBe('Red Hawks');
  });

  it('orders teams by average player salary (descending)', async () => {
    const result = await query<{
      allTeams: {
        nodes: {
          name: string;
          playersByTeamId: { aggregates: { average: { salary: string } } };
        }[];
      };
    }>({
      query: `
        query {
          allTeams(orderBy: PLAYERS_BY_TEAM_ID_AVERAGE_SALARY_DESC) {
            nodes {
              name
              playersByTeamId {
                aggregates {
                  average { salary }
                }
              }
            }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    const teams = result.data!.allTeams.nodes;
    expect(teams).toHaveLength(4);
    // Green Lions avg: (95000+68000)/2 = 81500
    // Red Hawks avg: (90000+75000+65000)/3 = 76666.67
    // Blue Jays avg: (85000+70000+60000)/3 = 71666.67
    // Gold Eagles avg: (72000+55000)/2 = 63500
    expect(teams[0].name).toBe('Green Lions');
    expect(teams[3].name).toBe('Gold Eagles');
  });

  it('filters teams by aggregate on child relation (sum goals > 20)', async () => {
    const result = await query<{
      allTeams: {
        nodes: {
          name: string;
        }[];
      };
    }>({
      query: `
        query {
          allTeams(
            where: {
              playersByTeamId: {
                aggregates: {
                  sum: {
                    goals: { greaterThan: "20" }
                  }
                }
              }
            }
          ) {
            nodes { name }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    const names = result.data!.allTeams.nodes.map(n => n.name).sort();
    // Red Hawks: 25 ✓, Green Lions: 22 ✓, Blue Jays: 18 ✗, Gold Eagles: 9 ✗
    expect(names).toEqual(['Green Lions', 'Red Hawks']);
  });

  it('filters teams by aggregate on child relation (average salary >= 75000)', async () => {
    const result = await query<{
      allTeams: {
        nodes: {
          name: string;
        }[];
      };
    }>({
      query: `
        query {
          allTeams(
            where: {
              playersByTeamId: {
                aggregates: {
                  average: {
                    salary: { greaterThanOrEqualTo: "75000" }
                  }
                }
              }
            }
          ) {
            nodes { name }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    const names = result.data!.allTeams.nodes.map(n => n.name).sort();
    // Green Lions: 81500 ✓, Red Hawks: 76666.67 ✓
    expect(names).toEqual(['Green Lions', 'Red Hawks']);
  });
});

// ============================================================================
// SCHEMA INTROSPECTION
// ============================================================================
describe('Schema introspection', () => {
  let teardown: () => Promise<void>;
  let query: QueryFn;

  beforeAll(async () => {
    const connections = await getConnectionsObject(
      {
        schemas: [SCHEMA],
        preset: testPreset,
        useRoot: true,
      },
      [seed.sqlfile([sqlFile('test-seed.sql')])]
    );

    teardown = connections.teardown;
    query = connections.query;
  });

  afterAll(async () => {
    if (teardown) await teardown();
  });

  it('connection type has aggregates field', async () => {
    const result = await query<{ __type: { fields: { name: string }[] } | null }>({
      query: `
        query {
          __type(name: "PlayerConnection") {
            fields { name }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    const fieldNames = result.data!.__type!.fields.map(f => f.name);
    expect(fieldNames).toContain('aggregates');
    expect(fieldNames).toContain('groupedAggregates');
    expect(fieldNames).toContain('nodes');
    expect(fieldNames).toContain('totalCount');
  });

  it('aggregates type has all standard aggregate fields', async () => {
    const result = await query<{ __type: { fields: { name: string }[] } | null }>({
      query: `
        query {
          __type(name: "PlayerAggregates") {
            fields { name }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    const fieldNames = result.data!.__type!.fields.map(f => f.name);
    expect(fieldNames).toContain('sum');
    expect(fieldNames).toContain('distinctCount');
    expect(fieldNames).toContain('min');
    expect(fieldNames).toContain('max');
    expect(fieldNames).toContain('average');
    expect(fieldNames).toContain('stddevSample');
    expect(fieldNames).toContain('stddevPopulation');
    expect(fieldNames).toContain('varianceSample');
    expect(fieldNames).toContain('variancePopulation');
    expect(fieldNames).toContain('keys');
  });

  it('GroupBy enum has attribute-based values', async () => {
    const result = await query<{ __type: { enumValues: { name: string }[] } | null }>({
      query: `
        query {
          __type(name: "PlayerGroupBy") {
            enumValues { name }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    const enumNames = result.data!.__type!.enumValues.map(e => e.name);
    expect(enumNames).toContain('TEAM_ID');
    expect(enumNames).toContain('POSITION');
  });

  it('Having input type exists with aggregate fields', async () => {
    const result = await query<{ __type: { inputFields: { name: string }[] } | null }>({
      query: `
        query {
          __type(name: "PlayerHavingInput") {
            inputFields { name }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    const fieldNames = result.data!.__type!.inputFields.map(f => f.name);
    expect(fieldNames).toContain('sum');
    expect(fieldNames).toContain('average');
    expect(fieldNames).toContain('min');
    expect(fieldNames).toContain('max');
  });

  it('orderBy enum has relational aggregate entries', async () => {
    const result = await query<{ __type: { enumValues: { name: string }[] } | null }>({
      query: `
        query {
          __type(name: "TeamOrderBy") {
            enumValues { name }
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    const enumNames = result.data!.__type!.enumValues.map(e => e.name);
    expect(enumNames).toContain('PLAYERS_BY_TEAM_ID_SUM_GOALS_ASC');
    expect(enumNames).toContain('PLAYERS_BY_TEAM_ID_SUM_GOALS_DESC');
    expect(enumNames).toContain('PLAYERS_BY_TEAM_ID_AVERAGE_SALARY_ASC');
    expect(enumNames).toContain('PLAYERS_BY_TEAM_ID_AVERAGE_SALARY_DESC');
  });
});
