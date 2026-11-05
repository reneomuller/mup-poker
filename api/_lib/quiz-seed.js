// Seed questions for the first quiz set (copied from docs/quiz-blok2.json; the docs folder is not read at runtime).
export const QUIZ_SEED = [
 {
  "q": "Co znamená CAC?",
  "a": [
   "Kolik stojí získat jednoho zákazníka",
   "Kolik zákazník utratí za rok",
   "Podíl zákazníků, kteří odejdou",
   "Měsíční opakované tržby"
  ],
  "correct": 0,
  "time": 20,
  "why": "CAC (Customer Acquisition Cost) = všechny náklady na marketing a prodej za období děleno počtem nově získaných zákazníků."
 },
 {
  "q": "LTV by podle běžného pravidla měla být aspoň…",
  "a": [
   "Poloviční než CAC",
   "Desetinásobkem MRR",
   "Stejná jako CAC",
   "Trojnásobkem CAC"
  ],
  "correct": 3,
  "time": 20,
  "why": "LTV je hrubý zisk z jednoho zákazníka za celou dobu, co u vás zůstane. Pravidlo LTV : CAC aspoň 3 : 1 znamená, že se získání zákazníka vyplatí i s rezervou."
 },
 {
  "q": "Churn je…",
  "a": [
   "Kolik firma měsíčně spálí peněz",
   "Cena za získání zákazníka",
   "Meziroční růst tržeb",
   "Podíl zákazníků, kteří za období odejdou"
  ],
  "correct": 3,
  "time": 20,
  "why": "Churn je míra odchodu: kolik procent zákazníků (nebo tržeb) za měsíc či rok odejde. Vysoký churn zkracuje LTV a růst pak teče jako z děravého kbelíku."
 },
 {
  "q": "Go-to-market (GTM) je…",
  "a": [
   "Kolo financování po seedu",
   "Plán, jak se produkt dostane k prvním zákazníkům",
   "První vstup firmy na burzu",
   "Měsíční opakované tržby"
  ],
  "correct": 1,
  "time": 20,
  "why": "Go-to-market je plán, komu, jakým kanálem a za kolik budete produkt prodávat – tedy jak se dostanete k prvním platícím zákazníkům."
 },
 {
  "q": "V jakých jednotkách se uvádí TAM?",
  "a": [
   "V počtu uživatelů",
   "V penězích za rok",
   "V procentech trhu",
   "V počtu firem v oboru"
  ],
  "correct": 1,
  "time": 20,
  "why": "TAM (Total Addressable Market) je celková roční útrata za daný typ řešení, proto se uvádí v penězích za rok, např. 2 mld. Kč ročně."
 },
 {
  "q": "Kterému odhadu trhu investoři věří nejvíc?",
  "a": [
   "SAM odhadnutému shora",
   "„Stačí nám 1 % trhu“",
   "SOM spočtenému zdola",
   "TAM z globální zprávy"
  ],
  "correct": 2,
  "time": 20,
  "why": "Odhad zdola (bottom-up) stojí na reálných číslech: kolik zákazníků umíte oslovit × kolik zaplatí. Proto mu investoři věří víc než „1 % z obřího trhu“."
 },
 {
  "q": "MVP je…",
  "a": [
   "Nejcennější zákazník firmy",
   "První verze produktu, která ověří, jestli o něj někdo stojí",
   "Hotový produkt připravený na velký launch",
   "Prezentace pro investory"
  ],
  "correct": 1,
  "time": 20,
  "why": "MVP (Minimum Viable Product) je nejjednodušší verze produktu, se kterou co nejrychleji a nejlevněji ověříte hlavní předpoklad u skutečných zákazníků."
 },
 {
  "q": "Runway je…",
  "a": [
   "Tempo růstu tržeb",
   "Doba, než firma vstoupí na burzu",
   "Na kolik měsíců firmě vystačí peníze",
   "Kolik firma měsíčně spálí"
  ],
  "correct": 2,
  "time": 20,
  "why": "Runway = peníze na účtu ÷ měsíční burn. Se 3 mil. Kč na účtu a výdaji 250 tis. Kč měsíčně firma vydrží 12 měsíců."
 },
 {
  "q": "Co je pivot?",
  "a": [
   "Zásadní změna směru podle toho, co jste zjistili",
   "Drobná úprava designu",
   "Prodej firmy investorovi",
   "První kolo financování"
  ],
  "correct": 0,
  "time": 20,
  "why": "Pivot je zásadní změna strategie – zákazníka, problému nebo byznys modelu – podle toho, co jste se naučili od trhu. Nejde o kosmetickou úpravu."
 },
 {
  "q": "Vertikální produkt…",
  "a": [
   "Prodává se jen firmám",
   "Prodává se jen v jedné zemi",
   "Slouží do hloubky jednomu odvětví",
   "Řeší jednu funkci pro všechny obory"
  ],
  "correct": 2,
  "time": 20,
  "why": "Vertikální produkt jde do hloubky jednoho odvětví (např. systém pro zubní ordinace). Horizontální řeší jednu funkci pro všechny obory (např. fakturace)."
 },
 {
  "q": "Moat je…",
  "a": [
   "Rezerva peněz, kterou má fond",
   "Podíl vyhrazený pro budoucí lidi",
   "Ochrana investora proti zředění",
   "Výhoda, kterou konkurence těžko okopíruje"
  ],
  "correct": 3,
  "time": 20,
  "why": "Moat (vodní příkop) je trvalá výhoda: síťové efekty, data, značka, patenty nebo vysoké náklady na přechod. Konkurence ji těžko okopíruje."
 },
 {
  "q": "Product-market fit znamená, že…",
  "a": [
   "Produkt má hotový design i značku",
   "Firma získala první investici",
   "Zákazníci produkt chtějí, používají a doporučují dál",
   "Produkt je levnější než konkurence"
  ],
  "correct": 2,
  "time": 20,
  "why": "Product-market fit nastává, když produkt řeší skutečný problém tak dobře, že ho zákazníci sami chtějí, platí za něj a doporučují – růst pak táhne trh, ne marketing."
 },
 {
  "q": "Co zjistíte z cap table?",
  "a": [
   "Kolik firma měsíčně utratí",
   "Koho firma letos nabere",
   "Kdo vlastní kolik procent firmy",
   "Které fondy investici odmítly"
  ],
  "correct": 2,
  "time": 20,
  "why": "Cap table ukazuje, kdo vlastní kolik akcií a procent firmy – zakladatelé, investoři, opční program – a jak se podíly mění s každým kolem."
 },
 {
  "q": "Vesting chrání hlavně…",
  "a": [
   "Firmu před konkurencí",
   "Tým zakladatelů, když někdo odejde dřív",
   "Zákazníky před zdražením",
   "Investory před down roundem"
  ],
  "correct": 1,
  "time": 20,
  "why": "Vesting: zakladatel získává podíl postupně, typicky 4 roky s ročním cliffem. Kdo odejde dřív, odchází jen s částí a zbytek zůstane firmě a týmu."
 },
 {
  "q": "Power law ve VC říká, že…",
  "a": [
   "Větší fond má vždy vyšší výnos",
   "Většinu výnosu fondu přinese pár investic",
   "Každá investice musí vydělat",
   "Riziko roste s cenou podílu"
  ],
  "correct": 1,
  "time": 20,
  "why": "Výnosy VC se řídí mocninným zákonem: většina investic vrátí málo nebo nic a jedna či dvě hvězdy vrátí celý fond i víc."
 }
];
