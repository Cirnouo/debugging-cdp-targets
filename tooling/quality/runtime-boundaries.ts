import path from 'node:path';
import { parse } from '@babel/parser';
import { isReferenced, type Node } from '@babel/types';

const APP_RUNTIME_IMPORTS = new Map<string, readonly string[]>([
    ['src/adapters/app-native.ts', ['fs-native-extensions']],
    ['src/adapters/mcp-http-server.ts', ['@modelcontextprotocol/node']],
    ['src/interface/app-bootstrap.ts', ['electron']],
    ['src/interface/app-main.ts', ['electron']],
    ['src/interface/app-window.ts', ['electron']],
    ['src/interface/app-preload.ts', ['electron']],
    ['src/interface/app-renderer.ts', ['react', 'react-dom/client']],
    ['src/interface/app-manager.ts', ['react']],
]);

const CONFIGURATION_DEPENDENCIES = new Map<string, readonly string[]>([
    ['src/desktop/configuration/model.ts', ['src/shared/errors.ts']],
    [
        'src/desktop/configuration/store.ts',
        [
            'node:crypto',
            'node:fs/promises',
            'node:path',
            'src/desktop/configuration/model.ts',
            'src/shared/errors.ts',
            'src/adapters/file-evidence.ts',
        ],
    ],
]);
const CONFIGURATION_MODEL_CONSUMERS = new Map<string, 'value' | 'type'>([
    ['src/desktop/configuration/store.ts', 'value'],
    ['src/interface/app-main.ts', 'type'],
    ['src/interface/app-manager.ts', 'value'],
    ['src/interface/app-window.ts', 'type'],
    ['src/application/app-host-management.ts', 'type'],
    ['src/desktop/contracts/commands.ts', 'value'],
    ['src/desktop/contracts/snapshots.ts', 'value'],
]);

const DESKTOP_CONTENT_DEPENDENCIES = new Map<string, { value: readonly string[]; type: readonly string[] }>([
    [
        'src/desktop/contracts/commands.ts',
        {
            value: [
                'src/desktop/contracts/snapshots.ts',
                'src/desktop/configuration/model.ts',
                'src/shared/errors.ts',
                'src/domains/control-contract.ts',
            ],
            type: ['src/domains/host-management.ts'],
        },
    ],
    [
        'src/desktop/contracts/snapshots.ts',
        {
            value: ['src/desktop/configuration/model.ts', 'src/shared/errors.ts', 'src/domains/control-contract.ts'],
            type: ['src/domains/host-management.ts', 'src/gateway/targets/model/isolation.ts'],
        },
    ],
    ['src/desktop/main/asset-policy.ts', { value: [], type: [] }],
    ['src/desktop/renderer/elapsed.ts', { value: [], type: [] }],
]);
const DESKTOP_CONTENT_CONSUMERS = new Map<string, ReadonlyMap<string, 'value' | 'type'>>([
    [
        'src/desktop/contracts/commands.ts',
        new Map([
            ['src/interface/app-window.ts', 'value'],
            ['src/interface/app-preload.ts', 'value'],
            ['src/interface/app-manager.ts', 'type'],
            ['src/interface/app-renderer.ts', 'type'],
            ['src/application/app-management.ts', 'value'],
            ['src/application/app-host-management.ts', 'type'],
        ]),
    ],
    [
        'src/desktop/contracts/snapshots.ts',
        new Map([
            ['src/desktop/contracts/commands.ts', 'value'],
            ['src/interface/app-main.ts', 'type'],
            ['src/interface/app-window.ts', 'value'],
            ['src/interface/app-preload.ts', 'value'],
            ['src/interface/app-manager.ts', 'value'],
            ['src/application/app-management.ts', 'value'],
            ['src/application/app-host-management.ts', 'type'],
        ]),
    ],
    ['src/desktop/main/asset-policy.ts', new Map([['src/interface/app-window.ts', 'value']])],
    ['src/desktop/renderer/elapsed.ts', new Map([['src/interface/app-manager.ts', 'value']])],
]);

const HOST_INTENT_DEPENDENCIES = new Map<string, { value: readonly string[]; type: readonly string[] }>([
    [
        'src/host-plugins/user-intent.ts',
        {
            value: ['smol-toml', 'src/domains/host-management.ts', 'src/shared/errors.ts'],
            type: [],
        },
    ],
    [
        'src/host-plugins/native/user-intent-file.ts',
        {
            value: [
                'node:fs/promises',
                'node:path',
                'src/shared/errors.ts',
                'src/adapters/file-evidence.ts',
                'src/host-plugins/user-intent.ts',
            ],
            type: ['src/domains/host-management.ts'],
        },
    ],
]);

const HOST_INTENT_CONSUMERS = new Map<string, readonly string[]>([
    [
        'src/host-plugins/user-intent.ts',
        ['src/host-plugins/native/user-intent-file.ts', 'src/adapters/native-host-plugins.ts'],
    ],
    ['src/host-plugins/native/user-intent-file.ts', ['src/adapters/native-host-plugins.ts']],
]);

function visit(
    node: unknown,
    callback: (node: Node, parent?: Node, grandparent?: Node) => void,
    parent?: Node,
    grandparent?: Node,
) {
    if (!node || typeof node !== 'object') return;
    // Only traverse parser-produced nodes; comments also carry a type field.
    const current =
        'type' in node && typeof node.type === 'string' && !node.type.startsWith('Comment')
            ? (node as Node)
            : undefined;
    if (current) callback(current, parent, grandparent);
    for (const value of Object.values(node)) {
        if (Array.isArray(value))
            for (const child of value) visit(child, callback, current ?? parent, current ? parent : grandparent);
        else if (value && typeof value === 'object')
            visit(value, callback, current ?? parent, current ? parent : grandparent);
    }
}

function expression(node: Node): Node {
    while (
        node.type === 'TSAsExpression' ||
        node.type === 'TSTypeAssertion' ||
        node.type === 'TSNonNullExpression' ||
        node.type === 'TSSatisfiesExpression' ||
        node.type === 'ParenthesizedExpression'
    )
        node = node.expression;
    return node;
}
function propertyName(node: Node): string | undefined {
    return node.type === 'Identifier' ? node.name : node.type === 'StringLiteral' ? node.value : undefined;
}

function bindingNames(node: Node | null | undefined): string[] {
    if (!node) return [];
    if (node.type === 'Identifier') return [node.name];
    if (node.type === 'RestElement') return bindingNames(node.argument);
    if (node.type === 'AssignmentPattern') return bindingNames(node.left);
    if (node.type === 'ArrayPattern') return node.elements.flatMap(bindingNames);
    if (node.type === 'ObjectPattern')
        return node.properties.flatMap((property) =>
            bindingNames(property.type === 'RestElement' ? property.argument : property.value),
        );
    return [];
}

type DependencyBindings = Record<string, { values: readonly string[]; types: readonly string[] }>;

function permitsExactImport(capabilities: DependencyBindings, specifier: string, declaration: Node | undefined) {
    const permitted = Object.hasOwn(capabilities, specifier) ? capabilities[specifier] : undefined;
    return (
        permitted &&
        declaration?.type === 'ImportDeclaration' &&
        declaration.specifiers.length > 0 &&
        declaration.specifiers.every((binding) => {
            if (binding.type !== 'ImportSpecifier' || binding.imported.type !== 'Identifier') return false;
            const name = binding.imported.name;
            const erased = declaration.importKind === 'type' || binding.importKind === 'type';
            return binding.local.name === name && (erased ? permitted.types : permitted.values).includes(name);
        })
    );
}

const OFFICIAL_UPSTREAM_BINDINGS: DependencyBindings = {
    'node:child_process': { values: ['spawn'], types: [] },
    '@modelcontextprotocol/client': {
        values: [
            'Client',
            'ProtocolError',
            'ProtocolErrorCode',
            'ReadBuffer',
            'SdkError',
            'SdkErrorCode',
            'serializeMessage',
        ],
        types: [
            'CallToolResult',
            'ElicitRequestFormParams',
            'ElicitResult',
            'JSONRPCMessage',
            'ListRootsResult',
            'Progress',
            'Tool',
            'Transport',
        ],
    },
    '@modelcontextprotocol/core': { values: ['CallToolResultSchema', 'ListToolsResultSchema'], types: [] },
    '../../domains/control-contract.ts': { values: [], types: ['Diagnose'] },
    '../../domains/request-failure.ts': { values: ['RequestFailure'], types: [] },
    '../diagnostics.ts': { values: ['measured'], types: [] },
    './execution.ts': { values: ['createOfficialExecution'], types: [] },
    './server-launch.ts': {
        values: [
            'buildOfficialLaunchArguments',
            'captureOfficialServerEnvironment',
            'resolveVerifiedOfficialServerBin',
        ],
        types: [],
    },
    '../../shared/constants.ts': { values: ['CLOSE_TIMEOUT_SECONDS'], types: [] },
};

function assignedValue(statement: Node | undefined, name: string) {
    const assignment = statement?.type === 'ExpressionStatement' ? statement.expression : undefined;
    return assignment?.type === 'AssignmentExpression' &&
        assignment.operator === '=' &&
        assignment.left.type === 'Identifier' &&
        assignment.left.name === name
        ? assignment.right
        : undefined;
}

/** The upstream may reap only the child obtained from its own native spawn. */
function ownedOfficialTermination(
    ast: ReturnType<typeof parse>,
    reviewedAmbient: Set<Node>,
    reviewedReferences: Set<Node>,
): Set<Node> {
    const allowed = new Set<Node>();
    const imports = (name: string, source: string) =>
        ast.program.body.some(
            (node) =>
                node.type === 'ImportDeclaration' &&
                node.importKind !== 'type' &&
                node.source.value === source &&
                node.specifiers.some(
                    (specifier) =>
                        specifier.type === 'ImportSpecifier' &&
                        specifier.importKind !== 'type' &&
                        propertyName(specifier.imported) === name &&
                        specifier.local.name === name,
                ),
        );
    if (!imports('spawn', 'node:child_process') || !imports('resolveVerifiedOfficialServerBin', './server-launch.ts'))
        return allowed;
    const declaration = ast.program.body.find(
        (node) =>
            node.type === 'ExportNamedDeclaration' &&
            node.declaration?.type === 'FunctionDeclaration' &&
            node.declaration.id?.name === 'openOfficialUpstream',
    );
    if (declaration?.type !== 'ExportNamedDeclaration' || declaration.declaration?.type !== 'FunctionDeclaration')
        return allowed;
    const body = declaration.declaration.body.body;
    const constant = (name: string) =>
        body
            .filter((node) => node.type === 'VariableDeclaration' && node.kind === 'const')
            .flatMap((node) => (node.type === 'VariableDeclaration' ? node.declarations : []))
            .find((node) => node.id.type === 'Identifier' && node.id.name === name);
    const child = constant('child');
    const bin = constant('bin');
    if (!constant('arguments_') || !child?.init || !bin?.init) return allowed;
    const binValue = expression(bin.init);
    const optionsProperty = (value: Node, property: string) =>
        value.type === 'MemberExpression' &&
        !value.computed &&
        value.object.type === 'Identifier' &&
        value.object.name === 'options' &&
        propertyName(value.property) === property;
    if (binValue.type !== 'LogicalExpression' || binValue.operator !== '??' || !optionsProperty(binValue.left, 'bin'))
        return allowed;
    const fallback = expression(binValue.right);
    if (
        fallback.type !== 'AwaitExpression' ||
        fallback.argument.type !== 'CallExpression' ||
        fallback.argument.callee.type !== 'Identifier' ||
        fallback.argument.callee.name !== 'resolveVerifiedOfficialServerBin' ||
        fallback.argument.arguments.length !== 0
    )
        return allowed;
    const creation = expression(child.init);
    if (creation.type !== 'CallExpression' || creation.callee.type !== 'Identifier' || creation.callee.name !== 'spawn')
        return allowed;
    const [executable, arguments_, options] = creation.arguments;
    const execPath =
        executable?.type === 'LogicalExpression' &&
        executable.operator === '??' &&
        optionsProperty(executable.left, 'nodeExecutable')
            ? executable.right
            : undefined;
    const ordinaryNode =
        execPath?.type === 'MemberExpression' &&
        !execPath.computed &&
        execPath.object.type === 'Identifier' &&
        execPath.object.name === 'process' &&
        propertyName(execPath.property) === 'execPath';
    if (
        creation.arguments.length !== 3 ||
        !ordinaryNode ||
        arguments_?.type !== 'ArrayExpression' ||
        arguments_.elements.length !== 2 ||
        arguments_.elements[0]?.type !== 'Identifier' ||
        arguments_.elements[0].name !== 'bin' ||
        arguments_.elements[1]?.type !== 'SpreadElement' ||
        arguments_.elements[1].argument.type !== 'Identifier' ||
        arguments_.elements[1].argument.name !== 'arguments_' ||
        options?.type !== 'ObjectExpression' ||
        options.properties.some((property) => property.type !== 'ObjectProperty' || property.computed)
    )
        return allowed;
    const shells = options.properties.filter(
        (property) =>
            property.type === 'ObjectProperty' && !property.computed && propertyName(property.key) === 'shell',
    );
    if (
        shells.length !== 1 ||
        shells[0]?.type !== 'ObjectProperty' ||
        shells[0].value.type !== 'BooleanLiteral' ||
        shells[0].value.value
    )
        return allowed;
    const expected = new Map([
        ['spawn', 1],
        ['resolveVerifiedOfficialServerBin', 1],
        ['child', 1],
        ['bin', 1],
        ['process', 0],
        ['options', 1],
        ['reapOwnedChild', 1],
    ]);
    const mutators = new Map([
        ['Object', new Set(['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf'])],
        ['Reflect', new Set(['set', 'defineProperty', 'deleteProperty', 'setPrototypeOf'])],
    ]);
    const protectedWrite = (node: Node): boolean => {
        const written = expression(node);
        if (written.type === 'MemberExpression' || written.type === 'OptionalMemberExpression')
            return protectedWrite(written.object);
        if (written.type === 'RestElement') return protectedWrite(written.argument);
        if (written.type === 'AssignmentPattern') return protectedWrite(written.left);
        if (written.type === 'ArrayPattern')
            return written.elements.some((element) => element !== null && protectedWrite(element));
        if (written.type === 'ObjectPattern')
            return written.properties.some((property) =>
                protectedWrite(property.type === 'RestElement' ? property.argument : property.value),
            );
        return bindingNames(written).some((name) => expected.has(name));
    };
    const bindings = new Map<string, number>();
    let reassigned = false;
    visit(ast, (node) => {
        let names: string[] = [];
        if (node.type === 'VariableDeclarator') {
            names = bindingNames(node.id);
            const value = node.init && expression(node.init);
            if (value?.type === 'Identifier' && value.name === 'child') reassigned = true;
        } else if (
            node.type === 'ImportSpecifier' ||
            node.type === 'ImportDefaultSpecifier' ||
            node.type === 'ImportNamespaceSpecifier'
        )
            names = bindingNames(node.local);
        else if (node.type === 'CatchClause') names = bindingNames(node.param);
        else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') names = bindingNames(node.id);
        else if (
            node.type === 'FunctionDeclaration' ||
            node.type === 'FunctionExpression' ||
            node.type === 'ArrowFunctionExpression' ||
            node.type === 'ObjectMethod' ||
            node.type === 'ClassMethod' ||
            node.type === 'ClassPrivateMethod'
        ) {
            names = node.params.flatMap(bindingNames);
            if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression')
                names.push(...bindingNames(node.id));
        }
        for (const name of names) bindings.set(name, (bindings.get(name) ?? 0) + 1);
        if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
            if (protectedWrite(node.type === 'AssignmentExpression' ? node.left : node.argument)) reassigned = true;
            if (node.type === 'AssignmentExpression') {
                const value = expression(node.right);
                if (value.type === 'Identifier' && value.name === 'child') reassigned = true;
            }
        }
        if ((node.type === 'ForInStatement' || node.type === 'ForOfStatement') && protectedWrite(node.left))
            reassigned = true;
        if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return;
        const callee = expression(node.callee);
        if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') return;
        const object = expression(callee.object);
        const method = propertyName(callee.property);
        const target = node.arguments[0];
        if (
            object.type === 'Identifier' &&
            method &&
            mutators.get(object.name)?.has(method) &&
            target &&
            protectedWrite(target)
        )
            reassigned = true;
    });
    if (reassigned || [...expected].some(([name, count]) => (bindings.get(name) ?? 0) !== count)) return allowed;
    const reaper = body.find((node) => node.type === 'FunctionDeclaration' && node.id?.name === 'reapOwnedChild');
    if (reaper?.type !== 'FunctionDeclaration' || !reaper.async || reaper.params.length !== 0) return allowed;
    reviewedAmbient.add(execPath.object);
    reviewedReferences.add(creation.callee);
    const resource = constant('resource')?.init;
    const close =
        resource?.type === 'ObjectExpression'
            ? resource.properties.find(
                  (property) =>
                      property.type === 'ObjectMethod' && !property.computed && propertyName(property.key) === 'close',
              )
            : undefined;
    const closeIfPending =
        close?.type === 'ObjectMethod'
            ? close.body.body.find(
                  (statement) =>
                      statement.type === 'IfStatement' &&
                      statement.test.type === 'UnaryExpression' &&
                      statement.test.operator === '!' &&
                      statement.test.argument.type === 'Identifier' &&
                      statement.test.argument.name === 'closing',
              )
            : undefined;
    if (closeIfPending?.type === 'IfStatement' && closeIfPending.consequent.type === 'BlockStatement') {
        const closeValue = assignedValue(closeIfPending.consequent.body[0], 'closing');
        if (
            closeValue?.type === 'CallExpression' &&
            closeValue.callee.type === 'MemberExpression' &&
            !closeValue.callee.computed &&
            propertyName(closeValue.callee.property) === 'finally'
        ) {
            const reap = closeValue.callee.object;
            if (
                reap.type === 'CallExpression' &&
                reap.arguments.length === 0 &&
                reap.callee.type === 'Identifier' &&
                reap.callee.name === 'reapOwnedChild'
            )
                reviewedReferences.add(reap.callee);
        }
    }
    const reaperBody = reaper.body;
    // The sole nested clock belongs to the timer racing the owned child's spawn event.
    const spawnTry = reaperBody.body.find((statement) => statement.type === 'TryStatement');
    const spawnWait = assignedValue(
        spawnTry?.type === 'TryStatement' ? spawnTry.block.body[0] : undefined,
        'spawnError',
    );
    const race = spawnWait?.type === 'AwaitExpression' ? spawnWait.argument : undefined;
    const racers =
        race?.type === 'CallExpression' &&
        race.callee.type === 'MemberExpression' &&
        !race.callee.computed &&
        race.callee.object.type === 'Identifier' &&
        race.callee.object.name === 'Promise' &&
        propertyName(race.callee.property) === 'race' &&
        race.arguments.length === 1
            ? race.arguments[0]
            : undefined;
    const timeout =
        racers?.type === 'ArrayExpression' &&
        racers.elements.length === 2 &&
        racers.elements[0]?.type === 'Identifier' &&
        racers.elements[0].name === 'spawned'
            ? racers.elements[1]
            : undefined;
    const timerCallback =
        timeout?.type === 'NewExpression' &&
        timeout.callee.type === 'Identifier' &&
        timeout.callee.name === 'Promise' &&
        timeout.arguments.length === 1
            ? timeout.arguments[0]
            : undefined;
    const timerStatement =
        timerCallback?.type === 'ArrowFunctionExpression' && timerCallback.body.type === 'BlockStatement'
            ? timerCallback.body.body[0]
            : undefined;
    const spawnTimer = timerStatement?.type === 'ExpressionStatement' ? timerStatement.expression : undefined;
    const deadline = reaperBody.body
        .flatMap((node) => (node.type === 'VariableDeclaration' && node.kind === 'const' ? node.declarations : []))
        .find((node) => node.id.type === 'Identifier' && node.id.name === 'deadline')?.init;
    const clocks = new Map<string, Node[]>();
    const signals = new Map<string, Node[]>();
    const parents = new Map<Node, Node>();
    const clockIsUnshadowed = !bindings.has('performance') && bindings.get('deadline') === 1;
    function waitsInReaper(call: Node, negated: boolean) {
        const awaited = parents.get(call);
        if (awaited?.type !== 'AwaitExpression') return false;
        const condition = negated ? parents.get(awaited) : awaited;
        if (
            !condition ||
            (negated &&
                (condition.type !== 'UnaryExpression' || condition.operator !== '!' || condition.argument !== awaited))
        )
            return false;
        const statement = parents.get(condition);
        return (
            statement?.type === 'IfStatement' && statement.test === condition && parents.get(statement) === reaperBody
        );
    }
    visit(reaper, (node, parent, grandparent) => {
        if (parent) parents.set(node, parent);
        if (
            clockIsUnshadowed &&
            node.type === 'CallExpression' &&
            node.arguments.length === 0 &&
            node.callee.type === 'MemberExpression' &&
            !node.callee.computed &&
            node.callee.object.type === 'Identifier' &&
            node.callee.object.name === 'performance' &&
            propertyName(node.callee.property) === 'now' &&
            parent?.type === 'BinaryExpression'
        ) {
            let site: string | undefined;
            if (
                parent === deadline &&
                parent.operator === '+' &&
                parent.left === node &&
                parent.right.type === 'BinaryExpression' &&
                parent.right.operator === '*' &&
                parent.right.left.type === 'Identifier' &&
                parent.right.left.name === 'CLOSE_TIMEOUT_SECONDS' &&
                parent.right.right.type === 'NumericLiteral' &&
                parent.right.right.value === 1000 &&
                imports('CLOSE_TIMEOUT_SECONDS', '../../shared/constants.ts')
            )
                site = 'deadline';
            if (
                parent.operator === '-' &&
                parent.right === node &&
                parent.left.type === 'Identifier' &&
                parent.left.name === 'deadline' &&
                grandparent?.type === 'CallExpression'
            ) {
                const [first, second] = grandparent.arguments;
                const callee = grandparent.callee;
                if (
                    callee.type === 'Identifier' &&
                    callee.name === 'waitForExit' &&
                    first === parent &&
                    !second &&
                    waitsInReaper(grandparent, true)
                )
                    site = 'kill';
                if (
                    callee.type === 'MemberExpression' &&
                    !callee.computed &&
                    callee.object.type === 'Identifier' &&
                    callee.object.name === 'Math' &&
                    second === parent &&
                    grandparent.arguments.length === 2
                ) {
                    const method = propertyName(callee.property);
                    const budgetCall = parents.get(grandparent);
                    if (budgetCall?.type === 'CallExpression' && budgetCall.callee.type === 'Identifier') {
                        if (
                            method === 'max' &&
                            first?.type === 'NumericLiteral' &&
                            first.value === 0 &&
                            budgetCall.callee.name === 'setTimeout' &&
                            budgetCall.arguments.length === 2 &&
                            budgetCall.arguments[1] === grandparent
                        ) {
                            const timer = parents.get(budgetCall);
                            if (
                                timer === spawnTimer &&
                                timer?.type === 'AssignmentExpression' &&
                                timer.operator === '=' &&
                                timer.left.type === 'Identifier' &&
                                timer.left.name === 'timer'
                            )
                                site = 'spawn';
                        }
                        if (
                            method === 'min' &&
                            first?.type === 'Identifier' &&
                            ['STDIN_GRACE_MS', 'TERM_GRACE_MS'].includes(first.name) &&
                            budgetCall.callee.name === 'waitForExit' &&
                            budgetCall.arguments.length === 1 &&
                            waitsInReaper(budgetCall, false)
                        )
                            site = first.name;
                    }
                }
            }
            if (site) {
                const candidates = clocks.get(site) ?? [];
                candidates.push(node.callee.object);
                clocks.set(site, candidates);
            }
        }
        if (
            node.type === 'CallExpression' &&
            node.callee.type === 'MemberExpression' &&
            !node.callee.computed &&
            node.callee.object.type === 'Identifier' &&
            node.callee.object.name === 'child' &&
            propertyName(node.callee.property) === 'kill' &&
            node.arguments.length === 1 &&
            node.arguments[0]?.type === 'StringLiteral' &&
            ['SIGTERM', 'SIGKILL'].includes(node.arguments[0].value)
        ) {
            const guarded =
                parent?.type === 'UnaryExpression' &&
                parent.operator === '!' &&
                parent.argument === node &&
                grandparent?.type === 'LogicalExpression' &&
                grandparent.operator === '&&' &&
                grandparent.left === parent
                    ? parents.get(grandparent)
                    : undefined;
            const statement =
                parent?.type === 'ExpressionStatement'
                    ? parent
                    : guarded?.type === 'IfStatement' && guarded.test === grandparent
                      ? guarded
                      : undefined;
            if (statement && parents.get(statement) === reaperBody) {
                const signal = node.arguments[0].value;
                const candidates = signals.get(signal) ?? [];
                candidates.push(node);
                signals.set(signal, candidates);
            }
        }
    });
    for (const candidates of signals.values()) {
        const [call] = candidates;
        if (call && candidates.length === 1) allowed.add(call);
    }
    if (clocks.get('deadline')?.length === 1)
        for (const candidates of clocks.values()) {
            const [clock] = candidates;
            if (clock && candidates.length === 1) reviewedAmbient.add(clock);
        }
    return allowed;
}

export function validateRuntimeSource(file: string, source: string) {
    const errors = [];
    let ast: ReturnType<typeof parse>;
    try {
        ast = parse(source, {
            sourceType: file.endsWith('.cjs') ? 'script' : 'module',
            plugins: ['typescript'],
            createImportExpressions: true,
        });
    } catch (error) {
        return [`${file}: invalid source: ${error instanceof Error ? error.message : String(error)}`];
    }
    const layer = file.split('/')[1];
    const desktop = layer === 'desktop';
    const hostIntentRole = HOST_INTENT_DEPENDENCIES.get(path.posix.normalize(file));
    const hostPayload = layer === 'host-plugins';
    const domain = layer === 'domains' || hostPayload;
    const gateway = layer === 'gateway';
    const diagnosticClock = file === 'src/gateway/diagnostics.ts';
    const resourceOwner = file === 'src/gateway/connections/resource-owner.ts';
    const directoryLease = file === 'src/gateway/connections/directory-lease.ts';
    const connectionOwner = resourceOwner || directoryLease;
    const core = file === 'src/gateway/core.ts';
    const registry = file === 'src/gateway/registry.ts';
    const managed = file === 'src/gateway/connections/managed-connection.ts';
    const admission = file === 'src/gateway/connections/start-admission.ts';
    const connectionView = file === 'src/gateway/connections/connection-view.ts';
    const gatewayService = core || registry || managed || admission || connectionView;
    const officialPackageFiles = file === 'src/gateway/official/package-files.ts';
    const officialLaunch = file === 'src/gateway/official/server-launch.ts';
    const officialUpstream = file === 'src/gateway/official/upstream.ts';
    const targetLifecycle = file === 'src/gateway/targets/target-lifecycle.ts';
    const reviewedAmbient = new Set<Node>();
    visit(ast, (node, parent, grandparent) => {
        if (
            targetLifecycle &&
            node.type === 'NewExpression' &&
            node.callee.type === 'Identifier' &&
            node.callee.name === 'Date' &&
            node.arguments.length === 0 &&
            parent?.type === 'MemberExpression' &&
            !parent.computed &&
            parent.object === node &&
            propertyName(parent.property) === 'toISOString' &&
            grandparent?.type === 'CallExpression' &&
            grandparent.callee === parent &&
            grandparent.arguments.length === 0
        )
            reviewedAmbient.add(node.callee);
        if (officialLaunch && node.type === 'FunctionDeclaration') {
            const name = node.id?.name;
            for (const [index, parameter] of node.params.entries()) {
                if (parameter.type !== 'AssignmentPattern' || parameter.left.type !== 'Identifier') continue;
                const value = parameter.right;
                if (
                    parameter.left.name === 'environment' &&
                    ((name === 'captureOfficialServerEnvironment' && index === 0) ||
                        (name === 'buildOfficialLaunchArguments' && index === 1)) &&
                    value.type === 'MemberExpression' &&
                    !value.computed &&
                    value.object.type === 'Identifier' &&
                    value.object.name === 'process' &&
                    propertyName(value.property) === 'env'
                )
                    reviewedAmbient.add(value.object);
                if (
                    name === 'buildOfficialLaunchArguments' &&
                    index === 3 &&
                    parameter.left.name === 'windowsEnvironment' &&
                    value.type === 'BinaryExpression' &&
                    value.operator === '===' &&
                    value.left.type === 'MemberExpression' &&
                    !value.left.computed &&
                    value.left.object.type === 'Identifier' &&
                    value.left.object.name === 'process' &&
                    propertyName(value.left.property) === 'platform' &&
                    value.right.type === 'StringLiteral' &&
                    value.right.value === 'win32'
                )
                    reviewedAmbient.add(value.left.object);
            }
        }
        if (
            (core || admission) &&
            node.type === 'MemberExpression' &&
            !node.computed &&
            node.object.type === 'Identifier'
        ) {
            const property = propertyName(node.property);
            const read =
                !(parent?.type === 'AssignmentExpression' && parent.left === node) &&
                !(parent?.type === 'UpdateExpression' && parent.argument === node) &&
                !(parent?.type === 'UnaryExpression' && parent.operator === 'delete');
            if (
                admission &&
                node.object.name === 'process' &&
                ((property === 'env' &&
                    parent?.type === 'SpreadElement' &&
                    parent.argument === node &&
                    grandparent?.type === 'ObjectExpression') ||
                    (property === 'platform' &&
                        read &&
                        parent?.type === 'BinaryExpression' &&
                        parent.operator === '===' &&
                        parent.left === node &&
                        parent.right.type === 'StringLiteral' &&
                        parent.right.value === 'win32'))
            )
                reviewedAmbient.add(node.object);
            if (
                core &&
                node.object.name === 'Date' &&
                property === 'now' &&
                parent?.type === 'LogicalExpression' &&
                parent.operator === '??' &&
                parent.right === node
            )
                reviewedAmbient.add(node.object);
        }
        if (
            registry &&
            node.type === 'CallExpression' &&
            node.arguments.length === 1 &&
            node.callee.type === 'MemberExpression' &&
            !node.callee.computed &&
            propertyName(node.callee.property) === 'write' &&
            node.callee.object.type === 'MemberExpression' &&
            !node.callee.object.computed &&
            propertyName(node.callee.object.property) === 'stderr' &&
            node.callee.object.object.type === 'Identifier' &&
            node.callee.object.object.name === 'process'
        )
            reviewedAmbient.add(node.callee.object.object);
    });
    const pure = domain || layer === 'shared' || gateway || desktop;
    const entry = file === 'src/interface/app-bootstrap.ts';
    const reviewedReferences = new Set<Node>();
    const ownedTerminations = officialUpstream
        ? ownedOfficialTermination(ast, reviewedAmbient, reviewedReferences)
        : new Set<Node>();
    const upstreamConsumerPath = core
        ? './official/upstream.ts'
        : managed || admission
          ? '../official/upstream.ts'
          : undefined;
    const upstreamImportNames = new Set(
        ast.program.body.flatMap((node) =>
            node.type === 'ImportDeclaration' && node.source.value === upstreamConsumerPath
                ? node.specifiers.map((specifier) => specifier.local.name)
                : [],
        ),
    );
    function dependency(specifier: unknown, typeOnly = false, declaration?: Node) {
        if (typeof specifier !== 'string') {
            errors.push(`${file}: computed module dependencies are prohibited.`);
            return;
        }
        if (specifier.startsWith('.') && /[\\%?#]/.test(specifier)) {
            errors.push(`${file}: relative source dependencies must use plain file paths.`);
            return;
        }
        if (specifier.startsWith('.') && !specifier.endsWith('.ts')) {
            errors.push(`${file}: relative source dependencies must use an explicit .ts extension.`);
            return;
        }
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
        const versionParser = file === 'src/domains/software-version.ts' && specifier === 'semver/functions/parse.js';
        const hostConfigParser =
            path.posix.normalize(file) === 'src/host-plugins/user-intent.ts' && specifier === 'smol-toml';
        const hostIntentDependency = specifier.startsWith('.') ? resolved : specifier;
        const permittedHostIntent =
            hostIntentRole?.value.includes(hostIntentDependency) ||
            (typeOnly && hostIntentRole?.type.includes(hostIntentDependency));
        if (hostIntentRole && !permittedHostIntent) errors.push(`${file}: unapproved Host intent dependency.`);
        const hostIntentConsumers = specifier.startsWith('.') ? HOST_INTENT_CONSUMERS.get(resolved) : undefined;
        if (hostIntentConsumers && !hostIntentConsumers.includes(path.posix.normalize(file)))
            errors.push(`${file}: unapproved Host intent consumer.`);
        const payloadComparison = file === 'src/host-plugins/payload-integrity.ts' && specifier === 'node:util';
        const modelConsumer = CONFIGURATION_MODEL_CONSUMERS.get(file);
        const configurationModel =
            specifier.startsWith('.') &&
            resolved === 'src/desktop/configuration/model.ts' &&
            (modelConsumer === 'value' || (modelConsumer === 'type' && typeOnly));
        if (resolved === 'src/desktop/configuration/model.ts' && !configurationModel)
            errors.push(`${file}: unapproved configuration model consumer or VALUE dependency.`);
        if (
            resolved === 'src/desktop/configuration/store.ts' &&
            (!specifier.startsWith('.') || file !== 'src/interface/app-main.ts')
        )
            errors.push(`${file}: only App Main may depend on the configuration store.`);
        const desktopConsumer = DESKTOP_CONTENT_CONSUMERS.get(resolved);
        if (desktopConsumer) {
            const role = desktopConsumer.get(file);
            if (!specifier.startsWith('.') || (role !== 'value' && !(role === 'type' && typeOnly)))
                errors.push(`${file}: unapproved desktop content consumer or VALUE dependency.`);
        }
        if (desktop) {
            const contentRole = DESKTOP_CONTENT_DEPENDENCIES.get(file);
            if (contentRole) {
                if (
                    !specifier.startsWith('.') ||
                    (!contentRole.value.includes(resolved) && !(typeOnly && contentRole.type.includes(resolved)))
                )
                    errors.push(`${file}: unapproved desktop content dependency.`);
            } else if (
                !CONFIGURATION_DEPENDENCIES.get(file)?.includes(specifier.startsWith('.') ? resolved : specifier)
            )
                errors.push(`${file}: unapproved configuration dependency.`);
        }
        const pureRelative =
            /^src\/(?:domains|shared)\//.test(resolved) || (hostPayload && resolved.startsWith('src/host-plugins/'));
        const targetValue =
            layer === 'domains' &&
            (resolved === 'src/gateway/targets/model/isolation.ts' ||
                resolved === 'src/gateway/targets/model/launch-command.ts');
        if (
            domain &&
            !versionParser &&
            !permittedHostIntent &&
            !payloadComparison &&
            !configurationModel &&
            (!specifier.startsWith('.') || (!pureRelative && !targetValue))
        ) {
            errors.push(`${file}: domains may depend only on domains and shared.`);
        }
        const mutableConnection =
            resolved === 'src/gateway/connections/resource-owner.ts' ||
            resolved === 'src/gateway/connections/directory-lease.ts';
        const mutableGateway =
            resolved === 'src/gateway/core.ts' ||
            resolved === 'src/gateway/registry.ts' ||
            resolved === 'src/gateway/connections/managed-connection.ts' ||
            resolved === 'src/gateway/connections/start-admission.ts' ||
            resolved === 'src/gateway/connections/connection-view.ts';
        const mutableTarget = resolved === 'src/gateway/targets/target-lifecycle.ts';
        if (targetLifecycle || mutableTarget) {
            const capabilities: DependencyBindings = targetLifecycle
                ? {
                      'node:crypto': { values: ['randomUUID'], types: [] },
                      '../../adapters/fixture-diagnostics.ts': { values: ['emitFixtureEvent'], types: [] },
                      '../../domains/control-contract.ts': {
                          values: [],
                          types: ['ControlContext', 'Disposition', 'LaunchContext', 'LaunchOptions', 'TargetStatus'],
                      },
                      '../connections/resource-owner.ts': {
                          values: ['createResourceOwner'],
                          types: ['ResourceOwner'],
                      },
                      './model/target-contract.ts': { values: ['RetainedTargetError'], types: ['ManagedTarget'] },
                      '../../shared/errors.ts': {
                          values: ['DetailedError', 'errorCode', 'errorDetails', 'errorMessage'],
                          types: [],
                      },
                  }
                : core
                  ? { './targets/target-lifecycle.ts': { values: [], types: ['TargetLifecycleHost'] } }
                  : registry
                    ? { './targets/target-lifecycle.ts': { values: [], types: ['TargetExitEvent'] } }
                    : managed
                      ? {
                            '../targets/target-lifecycle.ts': {
                                values: [],
                                types: ['createTargetLifecycle', 'TargetLifecycleHost', 'TargetLifecycleRouter'],
                            },
                        }
                      : admission
                        ? {
                              '../targets/target-lifecycle.ts': {
                                  values: ['createTargetLifecycle'],
                                  types: ['TargetLifecycleHost'],
                              },
                          }
                        : {};
            if (!permitsExactImport(capabilities, specifier, declaration))
                errors.push(`${file}: unapproved target lifecycle dependency or binding.`);
        }
        const mutableOfficialUpstream = resolved === 'src/gateway/official/upstream.ts';
        if (officialUpstream && !permitsExactImport(OFFICIAL_UPSTREAM_BINDINGS, specifier, declaration))
            errors.push(`${file}: unapproved Official upstream dependency or binding.`);
        if (mutableOfficialUpstream) {
            const capabilities: DependencyBindings = core
                ? { './official/upstream.ts': { values: ['openOfficialUpstream'], types: [] } }
                : admission
                  ? { '../official/upstream.ts': { values: ['openOfficialUpstream'], types: [] } }
                  : managed
                    ? { '../official/upstream.ts': { values: [], types: ['openOfficialUpstream', 'OfficialUpstream'] } }
                    : {};
            if (!permitsExactImport(capabilities, specifier, declaration))
                errors.push(
                    pure && !core && !admission && !managed
                        ? `${file}: pure owners cannot depend on Official upstream lifetime.`
                        : `${file}: unapproved Official upstream dependency or binding.`,
                );
        }
        if (pure && !gatewayService && mutableGateway)
            errors.push(`${file}: pure owners cannot depend on mutable Gateway services.`);
        if (layer === 'adapters' && mutableGateway)
            errors.push(`${file}: adapters cannot depend on mutable Gateway services.`);
        if (pure && !connectionOwner && !gatewayService && !targetLifecycle && mutableConnection)
            errors.push(`${file}: pure owners cannot depend on mutable connection owners.`);
        if (layer === 'adapters' && mutableConnection)
            errors.push(`${file}: adapters cannot depend on mutable connection owners.`);
        if (
            officialPackageFiles &&
            ![
                'node:crypto',
                'node:fs/promises',
                'node:path',
                './release-evidence.ts',
                '../../adapters/file-evidence.ts',
            ].includes(specifier)
        )
            errors.push(`${file}: unapproved Official package-file proof dependency.`);
        if (
            officialLaunch &&
            ![
                'node:path',
                './options.ts',
                './release-evidence.ts',
                './package-files.ts',
                '../../shared/errors.ts',
            ].includes(specifier)
        )
            errors.push(`${file}: unapproved Official launch-input dependency.`);
        if (
            pure &&
            !managed &&
            !admission &&
            !connectionView &&
            !officialLaunch &&
            !officialUpstream &&
            resolved === 'src/gateway/official/server-launch.ts'
        )
            errors.push(`${file}: pure owners cannot depend on Official launch inputs.`);
        if (pure && !officialPackageFiles && !officialLaunch && resolved === 'src/gateway/official/package-files.ts')
            errors.push(`${file}: pure owners cannot depend on Official package files.`);
        if (gatewayService && !mutableTarget && !mutableOfficialUpstream) {
            const permittedValue = (
                core
                    ? [
                          'node:crypto',
                          '../adapters/cdp-router.ts',
                          '../adapters/chrome-profile.ts',
                          '../adapters/data-directory.ts',
                          '../adapters/tool-catalog.ts',
                          '../shared/errors.ts',
                          '../application/client-context.ts',
                          '../application/registrations.ts',
                          './connections/managed-connection.ts',
                          './registry.ts',
                      ]
                    : managed
                      ? [
                            'node:crypto',
                            '../../adapters/port-reservation.ts',
                            '../../adapters/target-host.ts',
                            '../../application/client-context.ts',
                            '../../application/mcp-lifecycle.ts',
                            '../../domains/control-contract.ts',
                            '../../domains/request-failure.ts',
                            '../../shared/errors.ts',
                            '../diagnostics.ts',
                            '../official/server-launch.ts',
                            './connection-view.ts',
                            './start-admission.ts',
                        ]
                      : admission
                        ? [
                              'node:crypto',
                              'node:os',
                              'node:path',
                              '../../adapters/fixture-diagnostics.ts',
                              '../../application/client-context.ts',
                              '../../domains/control-contract.ts',
                              '../../shared/constants.ts',
                              '../../shared/errors.ts',
                              '../official/server-launch.ts',
                              '../targets/model/isolation.ts',
                              '../targets/model/launch-command.ts',
                              './directory-lease.ts',
                              './workspace-policy.ts',
                          ]
                        : connectionView
                          ? ['../../domains/control-contract.ts', '../official/server-launch.ts']
                          : registry
                            ? [
                                  './connections/resource-owner.ts',
                                  '../adapters/fixture-diagnostics.ts',
                                  '../domains/control-contract.ts',
                                  '../shared/errors.ts',
                              ]
                            : []
            ).includes(specifier);
            const permittedType =
                typeOnly &&
                (core
                    ? ['@modelcontextprotocol/client', '../domains/control-contract.ts', '../shared/client-context.ts']
                    : managed
                      ? [
                            '@modelcontextprotocol/client',
                            '../../adapters/chrome-profile.ts',
                            '../../adapters/data-directory.ts',
                            '../../adapters/tool-catalog.ts',
                            '../../application/registrations.ts',
                            '../registry.ts',
                            './resource-owner.ts',
                            '../../shared/client-context.ts',
                            './directory-lease.ts',
                            './workspace-policy.ts',
                        ]
                      : admission
                        ? [
                              '../../adapters/chrome-profile.ts',
                              '../../adapters/data-directory.ts',
                              '../../application/mcp-lifecycle.ts',
                              '../../application/registrations.ts',
                              '../registry.ts',
                              './managed-connection.ts',
                              './resource-owner.ts',
                              './connection-view.ts',
                          ]
                        : connectionView
                          ? ['../../adapters/tool-catalog.ts', '../registry.ts', './managed-connection.ts']
                          : registry
                            ? [
                                  './connections/managed-connection.ts',
                                  './connections/directory-lease.ts',
                                  '../application/registrations.ts',
                                  '../application/mcp-lifecycle.ts',
                                  '../shared/client-context.ts',
                              ]
                            : []
                ).includes(specifier);
            if (!permittedValue && !permittedType) errors.push(`${file}: unapproved Core or registry dependency.`);
        }
        if (connectionOwner) {
            const permittedType =
                typeOnly &&
                (resourceOwner
                    ? resolved === 'src/gateway/targets/model/target-contract.ts'
                    : resolved === 'src/gateway/targets/model/isolation.ts' ||
                      resolved === 'src/gateway/connections/resource-owner.ts');
            const permittedAdapter =
                directoryLease &&
                (resolved === 'src/adapters/data-directory.ts' || resolved === 'src/adapters/fixture-diagnostics.ts');
            if (!specifier.startsWith('.') || (!permittedType && !permittedAdapter))
                errors.push(`${file}: unapproved connection owner dependency.`);
        }
        if (
            gateway &&
            !connectionOwner &&
            !gatewayService &&
            !targetLifecycle &&
            !officialPackageFiles &&
            !officialLaunch &&
            !officialUpstream &&
            (!specifier.startsWith('.') || !/^src\/(?:gateway|domains|shared)\//.test(resolved))
        )
            errors.push(`${file}: gateway may depend only on gateway, domains and shared.`);
        if (diagnosticClock && (!specifier.startsWith('.') || resolved !== 'src/domains/control-contract.ts'))
            errors.push(`${file}: Gateway diagnostics may depend only on the pure control contract.`);
        if (
            pure &&
            !diagnosticClock &&
            !managed &&
            !officialUpstream &&
            (resolved === 'src/gateway/diagnostics.ts' || specifier === 'node:perf_hooks')
        )
            errors.push(`${file}: pure owners cannot depend on the diagnostic clock.`);
        if (layer === 'adapters' && /^src\/(?:application|interface)\//.test(resolved))
            errors.push(`${file}: adapter depends on an upper layer.`);
        if (layer === 'shared' && specifier.startsWith('.') && !resolved.startsWith('src/shared/'))
            errors.push(`${file}: shared cannot depend on other layers.`);
        if (layer === 'application' && resolved.startsWith('src/interface/'))
            errors.push(`${file}: application cannot depend on interface.`);
        if (
            !specifier.startsWith('.') &&
            !specifier.startsWith('node:') &&
            specifier !== 'ws' &&
            !APP_RUNTIME_IMPORTS.get(file)?.includes(specifier) &&
            !versionParser &&
            !hostConfigParser &&
            ![
                '@modelcontextprotocol/client',
                '@modelcontextprotocol/server',
                '@modelcontextprotocol/core',
                '@modelcontextprotocol/client/stdio',
                '@modelcontextprotocol/server/stdio',
            ].includes(specifier)
        )
            errors.push(`${file}: unapproved runtime dependency: ${specifier}`);
    }
    visit(ast, (node, parent, grandparent) => {
        if (
            pure &&
            node.type === 'Identifier' &&
            parent &&
            !(parent.type === 'TSMethodSignature' && !parent.computed && parent.key === node) &&
            isReferenced(node, parent, grandparent)
        ) {
            if (officialUpstream && !reviewedReferences.has(node)) {
                if (node.name === 'spawn') errors.push(`${file}: unapproved Official upstream spawn reference.`);
                if (node.name === 'reapOwnedChild')
                    errors.push(`${file}: unapproved Official upstream reaper reference.`);
                if (
                    node.name === 'child' &&
                    !(parent.type === 'MemberExpression' && !parent.computed && parent.object === node)
                )
                    errors.push(`${file}: unapproved owned child termination API alias.`);
            }
            let ambient = node.name;
            if (ambient === 'globalThis' || ambient === 'global') {
                const member = parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression';
                const property =
                    member && parent.object === node
                        ? parent.computed
                            ? parent.property.type === 'StringLiteral'
                                ? parent.property.value
                                : undefined
                            : propertyName(parent.property)
                        : undefined;
                if (!property || property === 'global' || property === 'globalThis')
                    errors.push(`${file}: cannot alias or compute ambient clock/process state.`);
                ambient = property ?? ambient;
            }
            if (ambient === 'process' && !reviewedAmbient.has(node))
                errors.push(`${file}: ${layer} cannot access process state.`);
            if (ambient === 'performance' || ambient === 'Date') {
                const reviewedRead =
                    diagnosticClock &&
                    node.name === 'performance' &&
                    parent.type === 'MemberExpression' &&
                    !parent.computed &&
                    parent.object === node &&
                    propertyName(parent.property) === 'now' &&
                    grandparent?.type === 'CallExpression' &&
                    grandparent.callee === parent &&
                    grandparent.arguments.length === 0;
                if (!reviewedRead && !reviewedAmbient.has(node))
                    errors.push(`${file}: cannot access ambient clock outside the reviewed diagnostic read.`);
            }
            if (['fetch', 'WebSocket', 'XMLHttpRequest'].includes(ambient))
                errors.push(`${file}: ${layer} cannot access ambient network I/O.`);
        }
        const object =
            node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression'
                ? expression(node.object)
                : undefined;
        const callee =
            node.type === 'CallExpression' || node.type === 'OptionalCallExpression'
                ? expression(node.callee)
                : undefined;
        if (
            (node.type === 'ImportDeclaration' ||
                node.type === 'ExportNamedDeclaration' ||
                node.type === 'ExportAllDeclaration') &&
            node.source
        ) {
            const typeOnly =
                node.type === 'ImportDeclaration'
                    ? node.importKind === 'type' ||
                      (node.specifiers.length > 0 &&
                          node.specifiers.every(
                              (specifier) => specifier.type === 'ImportSpecifier' && specifier.importKind === 'type',
                          ))
                    : node.exportKind === 'type' ||
                      (node.type === 'ExportNamedDeclaration' &&
                          node.specifiers.length > 0 &&
                          node.specifiers.every(
                              (specifier) => specifier.type === 'ExportSpecifier' && specifier.exportKind === 'type',
                          ));
            dependency(node.source.value, typeOnly, node);
        }
        const defaultExport = node.type === 'ExportDefaultDeclaration' ? expression(node.declaration) : undefined;
        if (
            (node.type === 'ExportNamedDeclaration' &&
                !node.source &&
                node.specifiers.some(
                    (specifier) =>
                        specifier.type === 'ExportSpecifier' && upstreamImportNames.has(specifier.local.name),
                )) ||
            (defaultExport?.type === 'Identifier' && upstreamImportNames.has(defaultExport.name))
        )
            errors.push(`${file}: unapproved Official upstream reexport.`);
        if (node.type === 'ImportExpression')
            dependency(node.source.type === 'StringLiteral' ? node.source.value : undefined);
        if (node.type === 'TSImportType') dependency(node.argument.value, true);
        if (node.type === 'TSImportEqualsDeclaration' && node.moduleReference.type === 'TSExternalModuleReference')
            dependency(
                node.moduleReference.expression.type === 'StringLiteral'
                    ? node.moduleReference.expression.value
                    : undefined,
                node.importKind === 'type',
            );
        if (
            (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') &&
            callee?.type === 'Identifier' &&
            callee.name === 'require'
        )
            dependency(node.arguments[0]?.type === 'StringLiteral' ? node.arguments[0].value : undefined);
        if (
            (domain || gateway) &&
            object?.type === 'Identifier' &&
            object.name === 'process' &&
            !reviewedAmbient.has(object)
        )
            errors.push(`${file}: ${layer} cannot access process state.`);
        if (
            !entry &&
            (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') &&
            object?.type === 'Identifier' &&
            object.name === 'process' &&
            propertyName(node.property) === 'argv'
        )
            errors.push(`${file}: CLI parsing belongs only in composition roots.`);
        if (
            officialUpstream &&
            (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') &&
            object?.type === 'Identifier' &&
            object.name === 'child' &&
            propertyName(node.property) === 'kill' &&
            !(parent?.type === 'CallExpression' && parent.callee === node && ownedTerminations.has(parent))
        )
            errors.push(`${file}: unapproved owned child termination API access.`);
        if (
            (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') &&
            (callee?.type === 'MemberExpression' || callee?.type === 'OptionalMemberExpression') &&
            propertyName(callee.property) === 'kill'
        ) {
            if (
                !(
                    (file === 'src/adapters/platform-process.ts' &&
                        expression(callee.object).type === 'Identifier' &&
                        propertyName(expression(callee.object)) === 'process' &&
                        ((node.arguments[1]?.type === 'StringLiteral' && node.arguments[1].value === 'SIGTERM') ||
                            (node.arguments[1]?.type === 'NumericLiteral' && node.arguments[1].value === 0))) ||
                    ownedTerminations.has(node)
                )
            )
                errors.push(`${file}: unapproved process termination API.`);
        }
        if (node.type === 'StringLiteral' && /session\.json|--categoryPwa|--viaCli|obsidian-devtools/.test(node.value))
            errors.push(`${file}: retired or forbidden runtime contract.`);
    });
    if (source.startsWith('#!') && !entry) errors.push(`${file}: only composition roots may be executable.`);
    return errors;
}
