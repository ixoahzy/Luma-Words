from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.section import WD_SECTION
from pathlib import Path

OUT = Path('/Users/kage/Documents/ChatGPT/luma words/IELTS_高级表达与替换手册.docx')

BLUE = '1F4D78'
MID = '2E74B5'
PALE = 'E8EEF5'
LIGHT = 'F4F6F9'
INK = '172033'
MUTED = '627083'
WHITE = 'FFFFFF'

def shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr(); shd = OxmlElement('w:shd'); shd.set(qn('w:fill'), fill); tcPr.append(shd)

def set_cell_margin(cell, top=80, start=120, bottom=80, end=120):
    tc = cell._tc; tcPr = tc.get_or_add_tcPr(); tcMar = tcPr.first_child_found_in('w:tcMar')
    if tcMar is None:
        tcMar = OxmlElement('w:tcMar'); tcPr.append(tcMar)
    for side, val in [('top', top), ('start', start), ('bottom', bottom), ('end', end)]:
        node = tcMar.find(qn(f'w:{side}'))
        if node is None: node = OxmlElement(f'w:{side}'); tcMar.append(node)
        node.set(qn('w:w'), str(val)); node.set(qn('w:type'), 'dxa')

def set_width(cell, dxa):
    tcPr = cell._tc.get_or_add_tcPr(); tcW = tcPr.find(qn('w:tcW'))
    if tcW is None: tcW = OxmlElement('w:tcW'); tcPr.append(tcW)
    tcW.set(qn('w:w'), str(dxa)); tcW.set(qn('w:type'), 'dxa')

def table_geometry(table, widths):
    table.autofit = False; table.alignment = WD_TABLE_ALIGNMENT.LEFT
    tblPr = table._tbl.tblPr
    tblW = tblPr.first_child_found_in('w:tblW')
    if tblW is None: tblW = OxmlElement('w:tblW'); tblPr.append(tblW)
    tblW.set(qn('w:w'), str(sum(widths))); tblW.set(qn('w:type'), 'dxa')
    tblInd = OxmlElement('w:tblInd'); tblInd.set(qn('w:w'), '120'); tblInd.set(qn('w:type'), 'dxa'); tblPr.append(tblInd)
    grid = table._tbl.tblGrid
    for child in list(grid): grid.remove(child)
    for w in widths:
        col = OxmlElement('w:gridCol'); col.set(qn('w:w'), str(w)); grid.append(col)
    for row in table.rows:
        for idx, cell in enumerate(row.cells):
            set_width(cell, widths[idx]); set_cell_margin(cell); cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

def font(run, size=10.5, bold=False, color=INK, italic=False):
    run.font.name = 'Aptos'; run._element.rPr.rFonts.set(qn('w:ascii'), 'Aptos'); run._element.rPr.rFonts.set(qn('w:hAnsi'), 'Aptos')
    run.font.size = Pt(size); run.bold = bold; run.italic = italic; run.font.color.rgb = RGBColor.from_string(color)

def add_text(p, text, size=10.5, bold=False, color=INK, italic=False):
    r = p.add_run(text); font(r, size, bold, color, italic); return r

def set_para(p, before=0, after=6, line=1.25, align=None):
    pf = p.paragraph_format; pf.space_before = Pt(before); pf.space_after = Pt(after); pf.line_spacing = line
    if align is not None: p.alignment = align

def add_title(doc, title, subtitle=None):
    p = doc.add_paragraph(); set_para(p, before=76, after=10, line=1.0, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_text(p, 'IELTS LANGUAGE PLAYBOOK', 11, True, MID)
    p = doc.add_paragraph(); set_para(p, after=10, line=1.0, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_text(p, title, 28, True, BLUE)
    if subtitle:
        p = doc.add_paragraph(); set_para(p, after=22, align=WD_ALIGN_PARAGRAPH.CENTER)
        add_text(p, subtitle, 12, False, MUTED)
    t = doc.add_table(rows=1, cols=3); table_geometry(t, [3120,3120,3120])
    vals = [('适用目标', 'IELTS 6.5–8.0'), ('覆盖场景', 'Writing + Speaking'), ('使用原则', '准确、自然、适度')]
    for i, (a,b) in enumerate(vals):
        c=t.cell(0,i); shade(c, LIGHT); p=c.paragraphs[0]; set_para(p, after=2, align=WD_ALIGN_PARAGRAPH.CENTER); add_text(p,a,9,True,MUTED)
        p=c.add_paragraph(); set_para(p, after=2, align=WD_ALIGN_PARAGRAPH.CENTER); add_text(p,b,10.5,True,BLUE)
    doc.add_paragraph()

def heading(doc, text, level=1):
    p=doc.add_paragraph(); set_para(p, before={1:18,2:12,3:8}[level], after={1:8,2:6,3:4}[level], line=1.0)
    add_text(p, text, {1:16,2:13,3:11.5}[level], True, BLUE if level<3 else MID)

def note(doc, label, text, kind='tip'):
    t=doc.add_table(rows=1, cols=2); table_geometry(t,[1120,8240]);
    shade(t.cell(0,0), MID if kind=='tip' else '7A5A00'); shade(t.cell(0,1), 'F4F8FD' if kind=='tip' else 'FFF8E6')
    p=t.cell(0,0).paragraphs[0]; set_para(p, after=0, align=WD_ALIGN_PARAGRAPH.CENTER); add_text(p,label,9,True,WHITE)
    p=t.cell(0,1).paragraphs[0]; set_para(p, after=0); add_text(p,text,10,False,INK)
    doc.add_paragraph().paragraph_format.space_after=Pt(2)

def bullets(doc, items):
    for item in items:
        p=doc.add_paragraph(style='List Bullet'); set_para(p, after=3, line=1.2); add_text(p,item,10.2)

def ref_table(doc, headers, rows, widths=(2050,2700,1550,3060)):
    t=doc.add_table(rows=1, cols=len(headers)); table_geometry(t,list(widths[:len(headers)]))
    for i,h in enumerate(headers):
        c=t.cell(0,i); shade(c, PALE); p=c.paragraphs[0]; set_para(p,after=0); add_text(p,h,9.5,True,BLUE)
    for ridx,row in enumerate(rows):
        cells=t.add_row().cells
        for i,value in enumerate(row):
            if ridx%2: shade(cells[i], 'FAFBFD')
            p=cells[i].paragraphs[0]; set_para(p,after=0,line=1.15); add_text(p,value,9.4, bold=(i==0))
    doc.add_paragraph().paragraph_format.space_after=Pt(4)

def add_section_table(doc, title, rows, widths=(2050,2700,1550,3060)):
    heading(doc,title,2); ref_table(doc,['基础表达','更自然 / 高级表达','语域','可直接套用'],rows,widths)

doc=Document()
sec=doc.sections[0]; sec.top_margin=Inches(0.78); sec.bottom_margin=Inches(0.72); sec.left_margin=Inches(0.8); sec.right_margin=Inches(0.7); sec.header_distance=Inches(0.35); sec.footer_distance=Inches(0.35)

styles=doc.styles
for name in ['Normal','List Bullet']:
    st=styles[name]; st.font.name='Aptos'; st._element.rPr.rFonts.set(qn('w:ascii'),'Aptos'); st._element.rPr.rFonts.set(qn('w:hAnsi'),'Aptos'); st.font.size=Pt(10.5)
styles['Normal'].paragraph_format.space_after=Pt(6); styles['Normal'].paragraph_format.line_spacing=1.25

# Quiet page footer
footer=sec.footer.paragraphs[0]; footer.alignment=WD_ALIGN_PARAGRAPH.CENTER; set_para(footer,after=0)
add_text(footer,'IELTS 高级表达与替换手册  |  以准确和自然为先',8.5,False,MUTED)

add_title(doc,'IELTS 高级表达与替换手册','写作与口语高频替换、搭配、句型与应用示例（中英对照）')
note(doc,'核心原则','高级不是“生僻”。IELTS 更看重：词义准确、搭配自然、句式有变化、语气与任务匹配。每次只替换你真正会用的表达。')
heading(doc,'如何使用本手册',1)
bullets(doc,[
    '先掌握“基础表达 → 自然升级”的一对一替换，再把例句改写成自己的内容。',
    'Writing 使用较正式、逻辑清晰的表达；Speaking 优先自然、具体和可延展。',
    '同一段落避免连续堆砌连接词；一个逻辑关系通常只需要一个连接信号。',
    '本手册中的 alternatives 是“可选表达”，不是必须全部使用。'
])
heading(doc,'目录',1)
bullets(doc,['1. 逻辑连接与衔接表达','2. 写作核心词汇升级','3. Academic Task 1 专用语言','4. Task 2 论证框架','5. Speaking Part 1–3 自然表达','6. 高频话题词汇与搭配','7. 高分句型库','8. 常见误区与自检清单'])

heading(doc,'1. 逻辑连接与衔接表达',1)
note(doc,'用法提醒','连接词的职责是标记逻辑，不是“显得高级”。先确定关系：补充、转折、因果、让步、替代、举例或总结。')
add_section_table(doc,'1.1 补充、并列与递进',[
('and','in addition / additionally','正式写作','Additionally, public transport should be made more affordable.'),
('also','moreover / furthermore','正式写作','Furthermore, the policy could reduce long-term healthcare costs.'),
('besides','what is more','中性','What is more, it gives residents greater flexibility.'),
('not only A but also B','A, as well as B','中性','The scheme benefits low-income families as well as local businesses.'),
('another point','equally importantly','写作','Equally importantly, children need time for unstructured play.'),
('more and more','increasingly','写作 / 口语','People are increasingly reliant on digital services.'),
])
add_section_table(doc,'1.2 对比、转折与让步',[
('but','however','正式写作','However, this approach may place an unfair burden on taxpayers.'),
('but','that said','口语 / 半正式','That said, convenience should not come at the expense of privacy.'),
('although','while / whereas','写作','Whereas cities offer more jobs, rural areas often provide a slower pace of life.'),
('even though','despite / in spite of','写作','Despite the initial cost, renewable energy is cheaper over time.'),
('on the other hand','by contrast','写作','By contrast, the proportion in France remained stable.'),
('still','nevertheless / nonetheless','正式写作','Nevertheless, the long-term benefits are likely to outweigh the drawbacks.'),
])
add_section_table(doc,'1.3 替代、选择与澄清（含 or / alternatively）',[
('or','or alternatively','正式写作','Students could attend in person or, alternatively, join the class online.'),
('or','otherwise','条件后果','People must comply with the rule; otherwise, they may face a fine.'),
('or rather','more precisely','自我修正 / 澄清','It takes an hour—or rather, about forty-five minutes—by train.'),
('or','instead','替换选择','Rather than banning cars, cities could instead introduce congestion charges.'),
('another way','an alternative is to...','写作','An alternative is to subsidise childcare for working parents.'),
('if not','failing that','正式 / 口语较少','Falling that, local councils could offer temporary support.'),
])
note(doc,'区别','or alternatively 常用于 Writing 的“两个可行方案”；or rather 用于“纠正或更精确地说”；otherwise 表示“不这样做会产生的后果”。不要把它们互换。','warn')
add_section_table(doc,'1.4 因果、结果与目的',[
('because','owing to / due to','写作','Owing to rising rents, many graduates continue to live with their parents.'),
('because','as / since','中性写作','Since public funds are limited, priorities must be set carefully.'),
('so','therefore / consequently','正式写作','Consequently, demand for skilled workers has increased.'),
('lead to','give rise to / result in','写作','Poor sleep can give rise to lower concentration levels.'),
('for this reason','for this reason / as a result','中性','As a result, commuters spend less time in traffic.'),
('to','with a view to / in order to','正式写作','The measure was introduced with a view to reducing waste.'),
])
add_section_table(doc,'1.5 举例、解释、重述与总结',[
('for example','for instance','中性','For instance, remote work can cut commuting time.'),
('like','such as','写作','Practical skills such as budgeting should be taught at school.'),
('that is','in other words','解释','In other words, the policy targets prevention rather than treatment.'),
('especially','particularly / notably','写作','This is particularly relevant in densely populated cities.'),
('in conclusion','overall / to sum up','结尾','Overall, regulation is preferable to an outright ban.'),
('finally','ultimately','结论 / 口语','Ultimately, the decision depends on local circumstances.'),
])

heading(doc,'2. 写作核心词汇升级',1)
note(doc,'搭配优先','把单词作为“词块”记忆：pose a threat、address an issue、a marked increase。单独背同义词容易出现搭配错误。')
add_section_table(doc,'2.1 高频动词：观点、变化与行动',[
('think','maintain / contend / argue','写作','Many researchers contend that early intervention is more effective.'),
('show','indicate / demonstrate / reveal','写作','The figures indicate a gradual decline in car ownership.'),
('make','implement / introduce / devise','写作','Governments should implement evidence-based policies.'),
('help','facilitate / enable / foster','写作','Reliable transport enables people to access employment.'),
('cause','trigger / contribute to / exacerbate','写作','Long working hours can exacerbate stress-related illnesses.'),
('solve','address / tackle / alleviate','写作','Affordable housing can alleviate pressure on young families.'),
('change','transform / reshape / alter','写作','Automation is reshaping the labour market.'),
('improve','enhance / strengthen / boost','写作','The programme could enhance digital literacy.'),
('reduce','curb / mitigate / ease','写作','Higher taxes may curb consumption of sugary drinks.'),
('use','rely on / make use of / utilise','写作','Companies increasingly rely on data-driven decisions.'),
])
add_section_table(doc,'2.2 高频名词与形容词',[
('problem','issue / challenge / concern','写作','Traffic congestion remains a pressing urban challenge.'),
('solution','measure / initiative / intervention','写作','One effective intervention is to expand preventive healthcare.'),
('effect','impact / implication / consequence','写作','The policy may have unintended consequences.'),
('good','beneficial / effective / worthwhile','写作','Public libraries are a worthwhile community investment.'),
('bad','harmful / counterproductive / detrimental','写作','Excessive screen time can be detrimental to sleep quality.'),
('important','crucial / pivotal / essential','写作','Parental involvement plays a pivotal role in language development.'),
('big','substantial / considerable / marked','Task 1','There was a marked increase in online sales.'),
('small','slight / marginal / modest','Task 1','The percentage saw only a marginal rise.'),
('many','a considerable proportion of','Task 1','A considerable proportion of respondents chose public transport.'),
('different','diverse / varied / distinct','写作','Cities need a diverse range of housing options.'),
])
add_section_table(doc,'2.3 形式化短语与自然替换',[
('a lot of','a considerable amount of / a wide range of','写作','A wide range of factors influence career choices.'),
('get better','improve / become more effective','写作','Services can become more effective through feedback.'),
('deal with','address / respond to','写作','Schools should address cyberbullying promptly.'),
('find out','identify / establish','写作','The study aims to identify the main barriers to exercise.'),
('give','provide / offer / deliver','写作','Universities should provide practical career guidance.'),
('have','experience / face / demonstrate','写作','Low-income households often face higher energy costs.'),
('do research','conduct research','写作','Researchers conducted a longitudinal study.'),
('make sure','ensure','写作','Authorities must ensure equal access to services.'),
])

heading(doc,'3. Academic Writing Task 1 专用语言',1)
note(doc,'Task 1 原则','只描述图表显示的内容，不解释未给出的原因；Overview 必须概括最显著的趋势、差异或极值。')
add_section_table(doc,'3.1 描述趋势与幅度',[
('go up','rise / climb / increase','中性','The figure rose steadily from 20% to 35%.'),
('go down','fall / decline / drop','中性','The rate declined gradually over the period.'),
('go up a lot','surge / soar / jump','强变化','Sales surged to just over 80,000 units.'),
('go down a lot','plunge / slump','强变化','The number plunged by almost half.'),
('stay the same','remain stable / level off','中性','After 2015, the proportion levelled off at around 60%.'),
('go up and down','fluctuate','中性','Prices fluctuated considerably between 2000 and 2005.'),
('highest point','peak at','Task 1','The figure peaked at 72% in 2018.'),
('lowest point','bottom out at','Task 1','The rate bottomed out at approximately 5%.'),
])
add_section_table(doc,'3.2 比较、比例与数据精度',[
('more than','exceed / outnumber','Task 1','Women outnumbered men in both age groups.'),
('less than','be lower than / fall below','Task 1','The figure fell below 10% by 2020.'),
('twice','twice as high as','Task 1','The rate for Group A was twice as high as that for Group B.'),
('about','approximately / roughly / just over','Task 1','Roughly one third of participants preferred cycling.'),
('most','the largest proportion','Task 1','The largest proportion was recorded in the 25–34 group.'),
('difference','a gap / a disparity','Task 1','There was a noticeable gap between the two countries.'),
])
heading(doc,'3.3 可直接套用的 Task 1 框架',2)
bullets(doc,[
    'Introduction: The chart illustrates / compares / presents information about … over the period from … to …',
    'Overview: Overall, it is clear that …, while … . The most notable feature is …',
    'Detail: X rose from A to B, whereas Y followed the opposite pattern, falling by …',
    'Process: The process begins with …, after which … . The final stage involves …',
    'Map: The most significant changes are the addition of … and the conversion of … into …'
])

heading(doc,'4. Task 2 论证与段落表达',1)
add_section_table(doc,'4.1 引言：改写题目与表明立场',[
('people think','It is often argued that…','正式','It is often argued that governments should fund public transport.'),
('I think','I am convinced that / I believe that','立场','I am convinced that prevention should receive greater funding.'),
('this essay will','This essay argues that…','写作','This essay argues that regulation is necessary but should remain proportionate.'),
('some people say','Supporters of this view maintain that…','写作','Supporters of this view maintain that university should be free.'),
])
add_section_table(doc,'4.2 主体段：观点、展开与例证',[
('first','One key reason is that…','写作','One key reason is that reliable transport expands access to jobs.'),
('this is because','This is largely because…','写作','This is largely because early habits tend to persist into adulthood.'),
('for example','A clear example is…','写作','A clear example is the use of congestion charges in major cities.'),
('this means','This means that / thereby…','写作','This means that households can allocate more income to essentials.'),
('another reason','A further consideration is…','写作','A further consideration is the long-term cost to the healthcare system.'),
('so','This can, in turn, …','写作','This can, in turn, reduce pressure on public services.'),
])
add_section_table(doc,'4.3 常见题型的逻辑骨架',[
('Discuss both views','View A → why valid; View B → why stronger / balanced judgement','写作','Although both positions have merit, I favour…'),
('Advantages / disadvantages','Identify one major benefit + one meaningful drawback; evaluate','写作','The principal advantage is…, whereas the main drawback is…'),
('Problems / solutions','Name precise problem → mechanism → targeted measure','写作','To address this, authorities could…'),
('Agree / disagree','Clear position + two non-overlapping reasons','写作','I largely agree because…'),
('Causes / effects','Cause chain or effect chain; avoid listing only','写作','This trend stems from…, which then leads to…'),
])
note(doc,'高分段落公式','主张（topic sentence）→ 为什么（mechanism）→ 后果（impact）→ 例子 / 限定条件（example or qualification）。一段只服务一个中心观点。')

heading(doc,'5. Speaking Part 1–3：自然且有层次的表达',1)
note(doc,'口语原则','考官更重视清楚、自然、可持续的交流。不要把书面词硬搬进口语；用具体细节和个人经历让答案“可听”。')
add_section_table(doc,'5.1 Part 1：展开短回答',[
('yes, I do','Yes, quite a lot, actually.','自然','Yes, quite a lot, actually, especially at weekends.'),
('I like it','I am quite fond of it / I really enjoy…','自然','I am quite fond of it because it helps me switch off.'),
('I do not like it','It is not really my cup of tea.','口语','Large crowds are not really my cup of tea.'),
('because','mainly because / partly because','口语','Mainly because it is convenient and does not cost much.'),
('often','on a regular basis / every now and then','口语','I go there every now and then when I need a break.'),
('very','particularly / genuinely / incredibly','自然','I find the area particularly relaxing in the evening.'),
])
add_section_table(doc,'5.2 Part 2：两分钟故事结构',[
('opening','I would like to talk about…','口语','I would like to talk about a teacher who had a real impact on me.'),
('time and place','This was back when… / It took place in…','叙事','This was back when I was in my final year of school.'),
('detail','What stood out to me was…','口语','What stood out to me was how patient she was.'),
('feeling','I was genuinely impressed / relieved / thrilled','口语','I was genuinely impressed by the amount of effort she put in.'),
('reflection','Looking back, I realise that…','高分反思','Looking back, I realise that it changed how I approach challenges.'),
])
add_section_table(doc,'5.3 Part 3：抽象讨论与平衡观点',[
('in my opinion','From my perspective / I would argue that','讨论','From my perspective, convenience has changed consumer behaviour.'),
('it depends','It largely depends on…','讨论','It largely depends on the age group and local infrastructure.'),
('both sides','There is a trade-off between… and…','讨论','There is a trade-off between efficiency and privacy.'),
('maybe','It is likely that / there is a good chance that','推测','There is a good chance that remote work will remain common.'),
('I am not sure','I have not looked into it in depth, but…','自然','I have not looked into it in depth, but I suspect cost is a factor.'),
('change','We are seeing a shift towards…','讨论','We are seeing a shift towards more flexible working patterns.'),
])
heading(doc,'5.4 口语的自然衔接与自我修正',2)
bullets(doc,[
    '组织：To begin with… / On top of that… / The other thing is… / Having said that…',
    '给自己思考时间：That is an interesting question. / Let me think for a second. / Off the top of my head…',
    '修正：Actually, I should say… / Or rather… / What I mean is… / To put it another way…',
    '限定：I would not say that… / It is not always the case, but… / To some extent…'
])

heading(doc,'6. 高频话题：可复用词块',1)
topic_rows=[
('教育 Education','curriculum design; practical skills; academic pressure; lifelong learning','Schools should strike a balance between academic knowledge and practical skills.'),
('科技 Technology','digital literacy; data privacy; automation; screen time','Digital literacy is essential, but data privacy should not be overlooked.'),
('环境 Environment','carbon emissions; renewable energy; waste management; conservation','Investment in renewable energy can reduce reliance on fossil fuels.'),
('健康 Health','preventive healthcare; sedentary lifestyle; mental well-being; balanced diet','Preventive healthcare is often more cost-effective than treating illness later.'),
('城市 City life','urban planning; affordable housing; public amenities; congestion','Better urban planning can make cities more liveable and inclusive.'),
('工作 Work','job satisfaction; work-life balance; transferable skills; job security','Flexible hours may improve work-life balance without reducing productivity.'),
('媒体 Media','misinformation; media literacy; online platforms; public awareness','Media literacy helps people evaluate information more critically.'),
('旅行 Travel','cultural immersion; tourist attractions; local economy; sustainable tourism','Sustainable tourism can support the local economy while protecting heritage sites.'),
]
ref_table(doc,['话题','核心词块','可套用观点句'],topic_rows,(1850,3900,3610))

heading(doc,'7. 高分句型库：准确比复杂更重要',1)
add_section_table(doc,'7.1 用于 Writing 的灵活句型',[
('让步','Although + clause, main clause','写作','Although online learning is convenient, it cannot fully replace face-to-face interaction.'),
('条件','Provided that / as long as + clause','写作','This is beneficial provided that access is equitable.'),
('强调','What matters most is…','写作 / 口语','What matters most is whether the policy is implemented fairly.'),
('非谓语','By + -ing, …','写作','By investing in cycle lanes, cities can encourage active travel.'),
('结果','…, thereby + -ing','写作','The measure lowers costs, thereby making services more accessible.'),
('比较','Compared with…, …','Task 1 / 2','Compared with private cars, buses use road space more efficiently.'),
('原因','This may be attributable to…','写作','This pattern may be attributable to changing work habits.'),
('限定','This is not to say that…','写作','This is not to say that technology is harmful in every context.'),
])
add_section_table(doc,'7.2 用于 Speaking 的灵活句型',[
('偏好','I tend to… because…','口语','I tend to cook at home because it is cheaper and more relaxing.'),
('习惯','I have got into the habit of…','口语','I have got into the habit of walking after dinner.'),
('过去与现在','I used to…, but these days…','口语','I used to read fiction, but these days I mostly read non-fiction.'),
('假设','If I had the chance, I would…','口语','If I had the chance, I would spend a year living abroad.'),
('影响','It has had a noticeable impact on…','口语','It has had a noticeable impact on how I manage my time.'),
('具体化','The first thing that comes to mind is…','口语','The first thing that comes to mind is the sense of community.'),
])

heading(doc,'8. 常见误区与 Band 7+ 自检',1)
ref_table(doc,['风险点','更好的做法','检查问题'],[
('强行替换 every word','保留准确的基础词；只升级关键动词、名词和连接','这个词是否比基础词更准确？'),
('堆砌连接词','每段 1–3 个逻辑标记通常足够','逻辑关系是否已被清楚表达？'),
('口语过度书面化','用自然短语和具体例子，不背诵“论文腔”','我会在真实对话中这样说吗？'),
('用 absolute words','用 often, tends to, may, in many cases 等限定','我的判断是否过度绝对？'),
('词义相近但搭配错误','背“动词 + 名词”组合，而非孤立同义词','这个搭配在语料中自然吗？'),
('Task 1 主观解释','只写数据、趋势和比较','该原因是图表给出的，还是我猜的？'),
('结论重复全文','重申立场 + 最终判断，不加新论点','最后一句是否真正回答题目？'),
],(2300,4300,2760))
heading(doc,'7 天练习计划',2)
bullets(doc,[
    'Day 1：从第 1 节挑选 15 个连接词，分别写一句自己的例句。',
    'Day 2：用第 2 节词块改写一篇旧 Task 2 的两个主体段。',
    'Day 3：选择一张 Task 1 图，刻意使用 8 个趋势与比较表达。',
    'Day 4：用 Part 2 结构录音 2 分钟，加入一个“Looking back…”反思。',
    'Day 5：任选两个话题，每题 Part 3 回答 40 秒，加入限定语。',
    'Day 6：把自己的 10 个常用基础词做成“基础 → 升级 → 例句”卡片。',
    'Day 7：完成一篇 Task 2，最后用第 8 节清单逐项自检。'
])
note(doc,'最后提醒','最稳定的提分路径是：准确表达 → 自然搭配 → 清晰逻辑 → 适量高级化。先把 50 个词块用熟，比记住 500 个罕见词更有效。')

doc.save(OUT)
print(OUT)
