// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  FORMULA_LIMITS, REQUIREMENT_LIMITS, MODIFIER_LIMITS, VALIDATION_LIMITS, EXPLANATION_LIMITS,
  ORCHESTRATION_LIMITS, createRulesetContext, evaluateFormula, evaluateRequirement, evaluateModifiers,
  evaluateValidation, buildExplanation, buildTrace, evaluate, projectExplanation, orchestrateRulesEvaluation,
  type FormulaNode, type ExplanationDocument,
} from "@prowess/rules";

// Every exported complexity constant has a maximum and one-over guard; the companion final-engine suite covers
// source length, group children, targets, resource/payment sources, validation checks, contributions and step count.
const span = {startOffset: 0, endOffset: 1};
const number = (): FormulaNode => ({type: "NUMBER", value: 1, ...span});
const unary = (operand: FormulaNode): FormulaNode => ({type: "UNARY", operator: "+", operand, ...span});
const balanced = (depth: number): FormulaNode => depth === 0 ? number() : {type: "BINARY", operator: "+", left: balanced(depth - 1), right: balanced(depth - 1), ...span};
const codes = (response: {errors: readonly {code: string}[]}) => response.errors.map(e => e.code);
const rule = {kind: "ENTITY_OWNED", entityId: "40000000-0000-4000-8000-000000000001"};
const ctx = createRulesetContext({rulesetId: "40000000-0000-4000-8000-000000000002",manifestId: "40000000-0000-4000-8000-000000000003",rules: []});
if (!ctx.ok) throw new Error("bad limit fixture");
const run = (steps: unknown[]) => orchestrateRulesEvaluation({evaluationKey:"audit.limits",contexts:{ruleset:ctx.value,actor:{stats:{n:1}}},plan:{steps}});
const formulaStep = (key: string, order = 1, bindings: unknown[] = [], variables: object = {x: 0}) => ({stepKey:key,order,operation:"FORMULA",input:{program:{expression:"1"},variables},bindings});
const binding = (key: string, pointer = "/stats/n") => ({target:`/variables/${key}`,source:{kind:"CONTEXT",context:"ACTOR",pointer}});

describe("WO12 remaining declared complexity boundaries", () => {
  it("Formula token limit: exact max() tokens and one additional token", () => {
    const expression = `max(${Array.from({length:(FORMULA_LIMITS.MAX_TOKENS - 2) / 2},()=>"1").join(",")})`;
    expect(evaluateFormula({expression},{}).success).toBe(true);
    expect(codes(evaluateFormula({expression:expression+"+"},{}))).toContain("FORMULA.EXPRESSION_LIMIT_EXCEEDED");
  });
  it("Formula AST node limit: 2048 balanced nodes versus 2049", () => {
    const ast = unary(balanced(10)); // 2047 nodes + one unary node
    expect(evaluateFormula({ast},{}).success).toBe(true);
    expect(codes(evaluateFormula({ast:unary(ast)},{}))).toContain("FORMULA.EXPRESSION_LIMIT_EXCEEDED");
  });
  it("Formula parser nesting: exact maximum and one over", () => {
    const expression = "(".repeat(FORMULA_LIMITS.MAX_NESTING_DEPTH)+"1"+")".repeat(FORMULA_LIMITS.MAX_NESTING_DEPTH);
    expect(evaluateFormula({expression},{}).success).toBe(true);
    expect(codes(evaluateFormula({expression:`(${expression})`},{}))).toContain("FORMULA.EXPRESSION_LIMIT_EXCEEDED");
  });
  it("Formula AST depth: exact maximum and one over", () => {
    let ast = number(); for(let i=1;i<FORMULA_LIMITS.MAX_AST_DEPTH;i++) ast=unary(ast);
    expect(evaluateFormula({ast},{}).success).toBe(true);
    expect(codes(evaluateFormula({ast:unary(ast)},{}))).toContain("FORMULA.EXPRESSION_LIMIT_EXCEEDED");
  });
  it("Requirement node budget: exact maximum and one over", () => {
    // Group width remains below 512 while the total reaches exactly 2048.
    const groups = Array.from({length:4},()=>({kind:"ALL",children:Array.from({length:510},()=>({...rule}))}));
    const root = {kind:"ALL",children:[...groups,rule,rule,rule]};
    expect(evaluateRequirement(root,{ownedEntityIds:[]}).success).toBe(true);
    expect(codes(evaluateRequirement({...root,children:[...root.children,rule]},{ownedEntityIds:[]}))).toContain("REQUIREMENT.LIMIT_EXCEEDED");
  });
  it("Requirement depth: exact maximum and one over", () => {
    let requirement: unknown = rule; for(let i=1;i<REQUIREMENT_LIMITS.MAX_DEPTH;i++) requirement={kind:"ALL",children:[requirement]};
    expect(evaluateRequirement(requirement,{ownedEntityIds:[]}).success).toBe(true);
    expect(codes(evaluateRequirement({kind:"ALL",children:[requirement]},{ownedEntityIds:[]}))).toContain("REQUIREMENT.LIMIT_EXCEEDED");
  });
  it("Modifier step ladder: exact maximum and one over", () => {
    const steps=Array.from({length:MODIFIER_LIMITS.MAX_STEPS_PER_TARGET},(_,i)=>`s${i}`);
    const target={targetKey:"t",kind:"ORDERED",steps,currentKey:"s0",boundaryPolicy:"CLAMP"};
    expect(evaluateModifiers({targets:[target],modifiers:[]}).success).toBe(true);
    expect(codes(evaluateModifiers({targets:[{...target,steps:[...steps,"extra"]}],modifiers:[]}))).toContain("MODIFIER.LIMIT_EXCEEDED");
  });
  it("Modifier count: exact maximum and one over", () => {
    const modifiers=Array.from({length:MODIFIER_LIMITS.MAX_MODIFIERS},(_,order)=>({modifierKey:`m${order}`,targetKey:"t",operation:"ADD",operand:0,phase:{phaseKey:"p",phaseOrder:1},priority:0,order}));
    const targets=[{targetKey:"t",kind:"NUMERIC",value:17}];
    expect(evaluateModifiers({targets,modifiers}).data?.finalTargets[0]).toMatchObject({value:17});
    expect(codes(evaluateModifiers({targets,modifiers:[...modifiers,{...modifiers[0],modifierKey:"extra"}]}))).toContain("MODIFIER.LIMIT_EXCEEDED");
  },60_000);
  it("Validation source count: exact maximum and one over", () => {
    const response=evaluateFormula({expression:"1"},{});
    const sources=Array.from({length:VALIDATION_LIMITS.MAX_SOURCES},(_,order)=>({sourceKey:`s${order}`,order,response}));
    expect(evaluateValidation({sources}).success).toBe(true);
    expect(codes(evaluateValidation({sources:[...sources,{...sources[0],sourceKey:"extra"}]}))).toContain("VALIDATION.LIMIT_EXCEEDED");
  },60_000);
  it("Validation finding count: exact maximum and explicit one-over rejection", () => {
    const message={kind:"VALIDATION" as const,severity:"INFO" as const,category:"STRUCTURE" as const,code:"AUDIT.NOTICE",message:"Notice",path:null,details:null,provenance:null};
    const response=evaluate({kind:"audit.notices",evaluate:()=>({data:null,messages:Array.from({length:VALIDATION_LIMITS.MAX_FINDINGS},()=>message)})},{kind:"audit.notices"});
    const source={sourceKey:"many",order:1,response};
    expect(evaluateValidation({sources:[source]}).data?.infoCount).toBe(VALIDATION_LIMITS.MAX_FINDINGS);
    const extra=evaluate({kind:"audit.notice",evaluate:()=>({data:null,messages:[message]})},{kind:"audit.notice"});
    expect(codes(evaluateValidation({sources:[source,{sourceKey:"extra",order:2,response:extra}]}))).toContain("VALIDATION.LIMIT_EXCEEDED");
  },60_000);
  it("Orchestration per-step and total binding limits: exact maxima and one over", () => {
    const variables=Object.fromEntries(Array.from({length:ORCHESTRATION_LIMITS.MAX_BINDINGS_PER_STEP},(_,i)=>[`n${i}`,0]));
    const bindings=Object.keys(variables).map(key=>binding(key));
    expect(run([formulaStep("one",1,bindings,variables)]).success).toBe(true);
    expect(codes(run([formulaStep("one",1,[...bindings,binding("extra")],{...variables,extra:0})]))).toContain("ORCHESTRATION.LIMIT_EXCEEDED");
    const steps=Array.from({length:ORCHESTRATION_LIMITS.MAX_TOTAL_BINDINGS / ORCHESTRATION_LIMITS.MAX_BINDINGS_PER_STEP},(_,i)=>formulaStep(`s${i}`,i,bindings,variables));
    expect(run(steps).success).toBe(true);
    expect(codes(run([...steps,formulaStep("extra",steps.length,[binding("x")])]))).toContain("ORCHESTRATION.LIMIT_EXCEEDED");
  },60_000);
  it("Orchestration pointer length and token count: accepted boundaries, rejected one over", () => {
    const long="/"+"x".repeat(ORCHESTRATION_LIMITS.MAX_POINTER_LENGTH-1);
    expect(run([formulaStep("a",1,[binding("x",long)])]).success).toBe(true);
    expect(run([formulaStep("a",1,[binding("x",long+"x")])]).success).toBe(false);
    const tokens=Array.from({length:ORCHESTRATION_LIMITS.MAX_POINTER_TOKENS},()=>"missing").map(x=>`/${x}`).join("");
    expect(run([formulaStep("a",1,[binding("x",tokens)])]).success).toBe(true);
    expect(run([formulaStep("a",1,[binding("x",tokens+"/missing")])]).success).toBe(false);
  });
  it("Explanation per-contribution and total node budgets: exact maxima and one over", () => {
    const response=evaluateFormula({expression:"17"},{});
    const trace=buildTrace(Array.from({length:EXPLANATION_LIMITS.MAX_TRACE_NODES_PER_CONTRIBUTION},(_,i)=>({key:`n${i}`,operation:"audit"})));
    const contribution=(key:string,order:number)=>({contributionKey:key,order,kind:"FORMULA",response:{...response,trace}});
    const input={explanationKey:"node.limit",contributions:[contribution("a",1),contribution("b",2)]};
    const detailed=buildExplanation(input);
    expect(detailed.success).toBe(true); expect(detailed.data!.sections.reduce((n,s)=>n+s.nodes.length,0)).toBe(EXPLANATION_LIMITS.MAX_TOTAL_NODES);
    expect(projectExplanation(detailed.data,"SUMMARY").success).toBe(true);
    const one=buildTrace([{key:"one",operation:"audit"}]);
    expect(codes(buildExplanation({...input,contributions:[...input.contributions,{contributionKey:"extra",order:3,kind:"FORMULA",response:{...response,trace:one}}]}))).toContain("EXPLANATION.LIMIT_EXCEEDED");
    const over=buildTrace([...trace.steps.map(n=>({key:n.key,operation:n.operation})),{key:"extra",operation:"audit"}]);
    expect(codes(buildExplanation({explanationKey:"over",contributions:[{...contribution("a",1),response:{...response,trace:over}}]}))).toContain("EXPLANATION.LIMIT_EXCEEDED");
  },60_000);
  it("Explanation depth maximum accepted and one over rejected by projection", () => {
    const base=buildExplanation({explanationKey:"depth",contributions:[{contributionKey:"a",order:1,kind:"FORMULA",response:evaluateFormula({expression:"1"},{})}]}).data!;
    const leaf=base.sections[0]!.nodes[0]!;
    let node={...leaf,children:[] as typeof leaf[]}; for(let i=1;i<EXPLANATION_LIMITS.MAX_TRACE_DEPTH;i++) node={...leaf,children:[node]};
    const doc:ExplanationDocument={...base,sections:[{...base.sections[0]!,nodes:[node]}]};
    expect(projectExplanation(doc,"DETAILED").success).toBe(true);
    expect(projectExplanation({...doc,sections:[{...doc.sections[0],nodes:[{...leaf,children:[node]}]}]},"DETAILED").success).toBe(false);
  },60_000);
});
