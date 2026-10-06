(function(){
  "use strict";
  var KEY = "cartharsis_app_v1";

  /* catalog is loaded from the Python backend (/api/catalog) */
  var QUICK = [], STORE = [], QUICK_CAT = ["All"];

  var COURIERS = [{name:"Raju",e:"🧢"},{name:"Bunty",e:"😎"},{name:"Priya",e:"👩‍🦰"},{name:"Sameer",e:"🧔"},{name:"Anjali",e:"👧"},{name:"Vicky",e:"🕶️"}];

  // delivery windows for Store items — demo playback durations map to real ETAs
  var WINDOWS = [
    {key:"asap",     short:"⚡ ASAP",     eta:"in minutes",         demo:12000},
    {key:"tonight",  short:"🌙 Tonight",  eta:"by 9 PM tonight",    demo:20000},
    {key:"tomorrow", short:"☀️ Tomorrow", eta:"tomorrow by 6 PM",   demo:30000},
    {key:"2days",    short:"📅 2 days",   eta:"in 2 days · Sun 2 PM", demo:44000}
  ];

  // flow entries: t = demo-playback ms (fast), disp = real-schedule minutes (shown on clock)
  var DELIVERY = {
    quick:{
      stageMs:2600, role:"10-min rider",
      push:["","📦 Packed in 90 sec! Raju is picking it up 🛍️","🛵 Raju has left — 5 min away","🏃 Raju is at your society gate!","⚡ Delivered! Tap to unbox 🎁"],
      stages:[{ic:"🧾",st:"Placed"},{ic:"🛍️",st:"Packing"},{ic:"🛵",st:"Rider assigned"},{ic:"⚡",st:"Arriving"},{ic:"✅",st:"Delivered"}],
      flow:[
        {t:300, disp:0, type:"courier", m:"Order aa gaya! Pack kar raha hoon ⚡"},
        {t:2600+200, disp:2, type:"system", m:"Packed in 90 seconds 🛍️"},
        {t:2600*2+200, disp:5, type:"courier", m:"Nikal gaya, 6 min me pahunchta hoon 🛵💨"},
        {t:2600*3+200, disp:8, type:"courier", m:"Society me ghus gaya, 1 min! 🏃"},
        {t:2600*4, disp:10, type:"courier", m:"Aa gaya! Darwaza kholo ⚡"}
      ]
    },
    store:{
      stageMs:8000, role:"Delivery partner",
      push:["","🫧 Packed & gift-wrapped with care 🎁","🚚 Shipped! Aa raha hai — get excited","🛵 Out for delivery — Priya has your parcel!","🔔 Priya's at your door — tap to unbox! 🎉"],
      stages:[{ic:"🧾",st:"Order placed"},{ic:"📦",st:"Packed"},{ic:"🚚",st:"Shipped"},{ic:"🛵",st:"Out for delivery"},{ic:"✅",st:"Delivered"}],
      flow:[
        {t:500, disp:0, type:"courier", m:"Order mil gaya boss! Packing shuru 📦"},
        {t:8000+400, disp:200, type:"system", m:"Packed with extra care 🫧"},
        {t:8000+1200, disp:210, type:"courier", m:"Bubble wrap laga diya, ekdum safe 🎁"},
        {t:8000*2+400, disp:1080, type:"courier", m:"Nikal pada hoon, aa raha hoon 🛵💨"},
        {t:8000*2+3500, disp:1110, type:"system", m:"Thoda traffic mila 🚦 — worth the wait"},
        {t:8000*3+400, disp:1680, type:"courier", m:"Bas 2 minute! Neeche aa jao 😄"},
        {t:8000*3+3500, disp:1685, type:"courier", m:"Aapke gate pe hoon... ghanti baja doon? 🔔"},
        {t:8000*4, disp:1710, type:"courier", m:"Deliver kar diya — ab kholo! 🎉"}
      ]
    }
  };

  var BADGES = [
    {id:"first", ic:"🎯", name:"First Resist", desc:"Complete your first fake checkout", test:function(s){return s.resisted>=1}},
    {id:"five", ic:"🖐️", name:"High Five", desc:"Resist 5 cravings", test:function(s){return s.resisted>=5}},
    {id:"5k", ic:"💸", name:"₹5,000 Saver", desc:"Keep ₹5,000 in your pocket", test:function(s){return s.saved>=5000}},
    {id:"25k", ic:"🏦", name:"Big Saver", desc:"Keep ₹25,000 total", test:function(s){return s.saved>=25000}},
    {id:"splurge", ic:"🐉", name:"Slayed a Splurge", desc:"Fake-buy something over ₹10,000", test:function(s){return s.maxItem>=10000}},
    {id:"streak3", ic:"🔥", name:"3-Day Streak", desc:"Use Cartharsis 3 different days", test:function(s){return s.streak>=3}},
    {id:"mindful", ic:"🧘", name:"Mindful Buyer", desc:"Buy something you truly wanted, after the wait", test:function(s){return (s.bought||0)>=1}}
  ];

  var state = load();
  var shopMode = "quick";
  var quickCat = "All";
  var storeQuery = "";
  var storeDept = "All";
  var selectedWindow = "2days";
  var TRENDING = [], DEPTS = [];
  var lastUpdated = 0;
  var searchResults = null, searchQuery = "", AMZ_LIVE = false;
  var el = function(id){return document.getElementById(id)};
  var money = function(n){return "₹" + Math.round(n).toLocaleString("en-IN")};

  function load(){
    var base = {cart:[], orders:[], saved:0, resisted:0, items:0, maxItem:0, days:[], spent:0, bought:0, onboarded:false, profile:null, speedMode:"demo"};
    try{ var raw = localStorage.getItem(KEY); if(raw){ return Object.assign(base, JSON.parse(raw)); } }catch(e){}
    return base;
  }
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){} }
  function markDay(){ var d=new Date().toISOString().slice(0,10); if(state.days.indexOf(d)===-1) state.days.push(d); }
  function streak(){ return state.days.length; }
  function stars(r){ var full=Math.round(r); var s=""; for(var i=0;i<5;i++) s+= i<full?"★":"☆"; return s; }
  function esc(t){ return (t==null?"":String(t)).replace(/"/g,"&quot;").replace(/</g,"&lt;"); }
  function studioBg(){ return "radial-gradient(circle at 50% 30%, #ffffff 0%, #f3f6f2 68%, #e7ece7 130%)"; }
  // product image (real photo) or emoji fallback
  function pimg(it){
    if(it.image) return '<img class="pimg" src="'+esc(it.image)+'" alt="'+esc(it.name)+'" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{textContent:\'🛍️\',className:\'pimg\',style:\'display:grid;place-items:center;font-size:2rem\'}))">';
    return '<span class="pimg" style="display:grid;place-items:center;font-size:2rem">'+(it.emoji||"🛍️")+'</span>';
  }

  /* ---------- top ---------- */
  function renderTop(){
    el("savedAmt").textContent = money(state.saved);
    el("resistCount").textContent = state.resisted;
    el("streakCount").textContent = streak();
  }

  /* ---------- shop: quick ---------- */
  function renderChips(){
    var c = el("catChips"); c.innerHTML="";
    QUICK_CAT.forEach(function(cat){
      var b=document.createElement("button");
      b.className="chip"+(cat===quickCat?" active":"");
      b.textContent=cat;
      b.addEventListener("click",function(){ quickCat=cat; renderChips(); renderQuick(); });
      c.appendChild(b);
    });
  }
  function renderQuick(){
    var g=el("quickGrid"); g.innerHTML="";
    QUICK.forEach(function(it,i){
      if(quickCat!=="All" && it.cat!==quickCat) return;
      var card=document.createElement("div"); card.className="q-card";
      var mrp = it.mrp>it.price ? '<span class="m">'+money(it.mrp)+'</span>' : '';
      card.innerHTML=
        '<div class="q-tile" style="background:'+studioBg()+'">'+pimg(it)+'</div>'+
        '<div class="q-qty">'+esc(it.qty||"")+'</div>'+
        '<div class="q-name">'+esc(it.name)+'</div>'+
        '<div class="q-pr"><span class="p">'+money(it.price)+'</span>'+mrp+'</div>'+
        '<button class="q-add" data-i="'+i+'">Add</button>';
      g.appendChild(card);
    });
    g.querySelectorAll(".q-add").forEach(function(b){
      b.addEventListener("click",function(){
        var it=QUICK[+b.dataset.i];
        addToCart({name:it.name, price:it.price, image:it.image, source:"quick"});
        b.textContent="Added ✓"; b.classList.add("added");
        setTimeout(function(){ b.textContent="Add"; b.classList.remove("added"); },1000);
      });
    });
  }

  /* ---------- shop: trending ---------- */
  function trendCard(it){
    return '<div class="trend-card">'+
      '<span class="t-rank">#'+it.rank+'</span>'+
      '<div class="t-tile">'+pimg(it)+'</div>'+
      '<div class="t-body"><div class="t-name">'+esc(it.name)+'</div>'+
      '<div class="t-price">'+money(it.price)+'</div>'+
      '<button class="t-add" data-tn="'+esc(it.name)+'" data-tp="'+it.price+'" data-timg="'+esc(it.image||"")+'">Add</button></div></div>';
  }
  function renderTrending(){
    var r=el("trendingRow"); if(!r) return;
    if(!TRENDING.length){ r.innerHTML='<div class="loading">'+(AMZ_LIVE?'⏳ Loading live Amazon…':'No trending items')+'</div>'; return; }
    r.innerHTML=TRENDING.map(trendCard).join("");
    r.querySelectorAll(".t-add").forEach(function(b){
      b.addEventListener("click",function(){
        addToCart({name:b.dataset.tn, price:+b.dataset.tp, image:b.dataset.timg, source:"store"});
        b.textContent="Added ✓"; b.classList.add("added");
        setTimeout(function(){ b.textContent="Add"; b.classList.remove("added"); },1000);
      });
    });
  }
  function renderStoreChips(){
    var c=el("storeChips"); if(!c) return; c.innerHTML="";
    ["All"].concat(DEPTS).forEach(function(d){
      var b=document.createElement("button");
      b.className="chip"+(d===storeDept?" active":"");
      b.textContent=d;
      b.addEventListener("click",function(){ storeDept=d; searchResults=null; renderStoreChips(); renderStore(); });
      c.appendChild(b);
    });
  }

  /* ---------- shop: store ---------- */
  function storeCard(it){
    var off = it.mrp>it.price ? Math.round((it.mrp-it.price)/it.mrp*100) : 0;
    var offTag = off>0 ? '<span class="s-off">'+off+'% off</span>' : '';
    var offPr = off>0 ? '<span class="m">'+money(it.mrp)+'</span><span class="off">'+off+'% off</span>' : '';
    return '<div class="s-card">'+
      '<div class="s-tile" style="background:'+studioBg()+'">'+offTag+pimg(it)+'</div>'+
      '<div class="s-body"><div class="s-name">'+esc(it.name)+'</div>'+
      '<div class="s-rate"><span class="stars">'+stars(it.rating||4)+'</span><span class="cnt">'+(it.rating||4).toFixed(1)+' ('+esc(it.reviews||"")+')</span></div>'+
      '<div class="s-pr"><span class="p">'+money(it.price)+'</span>'+offPr+'</div>'+
      '<button class="s-add" data-n="'+esc(it.name)+'" data-p="'+it.price+'" data-img="'+esc(it.image||"")+'">Add to cart</button></div></div>';
  }
  function wireStore(g){
    g.querySelectorAll(".s-add").forEach(function(b){
      b.addEventListener("click",function(){
        addToCart({name:b.dataset.n, price:+b.dataset.p, image:b.dataset.img, source:"store"});
        b.textContent="Added ✓"; b.classList.add("added");
        setTimeout(function(){ b.textContent="Add to cart"; b.classList.remove("added"); },1000);
      });
    });
    var cs=el("clearSearch");
    if(cs) cs.addEventListener("click",function(){ searchResults=null; searchQuery=""; storeQuery=""; el("storeSearch").value=""; renderStore(); });
  }
  function renderStore(){
    var g=el("storeGrid"); var list, banner="";
    if(searchResults!==null){
      list=searchResults;
      banner='<div class="search-banner"><span class="amz">'+(AMZ_LIVE?"🅰️ Amazon":"Demo")+' results</span> for <b>"'+esc(searchQuery)+'"</b> · '+list.length+' found <button id="clearSearch">Clear ✕</button></div>';
    }else{
      var q=storeQuery.trim().toLowerCase();
      list=STORE.filter(function(it){
        if(storeDept!=="All" && it.dept!==storeDept) return false;
        if(q && it.name.toLowerCase().indexOf(q)===-1) return false;
        return true;
      });
    }
    if(!list.length){
      var msg = (searchResults===null && AMZ_LIVE && STORE.length===0)
        ? '⏳ Loading live Amazon products… (thoda ruko)'
        : 'Kuch nahi mila — koi aur cheez search karo.';
      g.innerHTML=banner+'<div class="loading">'+msg+'</div>'; wireStore(g); return;
    }
    g.innerHTML=banner+list.map(storeCard).join("");
    wireStore(g);
  }
  function liveSearch(q){
    q=(q||"").trim();
    if(!q){ searchResults=null; renderStore(); return; }
    searchQuery=q;
    var g=el("storeGrid"); g.innerHTML='<div class="loading">🔎 Searching '+(AMZ_LIVE?"Amazon":"")+' for "'+esc(q)+'"…</div>';
    fetch("/api/search?q="+encodeURIComponent(q)).then(function(r){ return r.json(); }).then(function(data){
      AMZ_LIVE=!!data.live;
      searchResults=data.results||[];
      renderStore();
    }).catch(function(){ g.innerHTML='<div class="loading">Search fail hua — dobara try karo.</div>'; });
  }

  function setMode(mode){
    shopMode=mode;
    document.querySelectorAll(".mode-toggle button").forEach(function(b){ b.classList.toggle("active", b.dataset.mode===mode); });
    el("quickView").hidden = mode!=="quick";
    el("storeView").hidden = mode!=="store";
    if(mode==="quick"){ renderQuick(); }
    else { renderStoreChips(); renderTrending(); renderStore(); }
  }
  function agoLabel(ts){
    if(!ts) return "just now";
    var s=Math.max(0, Math.floor(Date.now()/1000 - ts));
    if(s<10) return "just now";
    if(s<60) return s+"s ago";
    var m=Math.floor(s/60); return m+"m ago";
  }

  /* ---------- cart ---------- */
  function addToCart(x){
    state.cart.push({name:x.name, price:+x.price||0, image:x.image||null, emoji:x.emoji||null, source:x.source||"store"});
    save(); renderCart(); renderNav();
    toast(x.name+" added to cart");
  }
  function renderCart(){
    var list=el("cartList"); list.innerHTML="";
    if(state.cart.length===0){
      el("cartFooter").hidden=true;
      list.innerHTML='<div class="empty"><div class="big">🛒</div><h3>Cart\'s empty</h3><p>Go add whatever you\'re craving.</p></div>';
      return;
    }
    el("cartFooter").hidden=false;
    renderWindowPicker();
    var total=0;
    state.cart.forEach(function(it,i){
      total+=it.price;
      var pill = it.source==="quick" ? '<span class="src-pill quick">⚡ Quick</span>' : '<span class="src-pill store">📦 Store</span>';
      var row=document.createElement("div"); row.className="cart-item";
      row.innerHTML=
        '<div class="ci-tile" style="background:'+studioBg()+'">'+pimg(it)+'</div>'+
        '<div><div class="ci-name">'+esc(it.name)+'</div><div class="ci-meta">'+pill+'<span class="ci-price">'+money(it.price)+'</span></div></div>'+
        '<button class="ci-rm" data-i="'+i+'" aria-label="Remove">×</button>';
      list.appendChild(row);
    });
    list.querySelectorAll(".ci-rm").forEach(function(b){
      b.addEventListener("click",function(){ state.cart.splice(+b.dataset.i,1); save(); renderCart(); renderNav(); });
    });
    el("cartTotal").textContent=money(total);
    el("cartKeep").textContent=money(total);
  }
  function renderNav(){
    var n=state.cart.length, badge=el("navCount");
    if(n>0){ badge.hidden=false; badge.textContent=n; } else badge.hidden=true;
  }
  function renderWindowPicker(){
    var hasStore = state.cart.some(function(x){ return x.source==="store"; });
    el("deliveryWindow").hidden = !hasStore;
    if(!hasStore) return;
    var c=el("dwChips"); c.innerHTML="";
    WINDOWS.forEach(function(w){
      var b=document.createElement("button");
      b.className="dw-chip"+(w.key===selectedWindow?" active":"");
      b.innerHTML=w.short+'<small>'+w.eta+'</small>';
      b.addEventListener("click",function(){ selectedWindow=w.key; renderWindowPicker(); });
      c.appendChild(b);
    });
  }

  /* ---------- checkout: split by source ---------- */
  function checkout(){
    if(state.cart.length===0) return;
    var groups={};
    state.cart.forEach(function(it){ (groups[it.source]=groups[it.source]||[]).push(it); });
    var grandTotal=0, maxI=0;
    var win = WINDOWS.filter(function(w){return w.key===selectedWindow;})[0] || WINDOWS[3];
    Object.keys(groups).forEach(function(src){
      var items=groups[src];
      var total=items.reduce(function(a,x){return a+x.price},0);
      grandTotal+=total;
      maxI=Math.max(maxI, items.reduce(function(a,x){return Math.max(a,x.price)},0));
      var stageMs;
      if(state.speedMode==="real"){ stageMs = realDurationMs(src, selectedWindow)/4; }
      else { stageMs = src==="quick" ? DELIVERY.quick.stageMs : win.demo/4; }
      var eta = src==="quick" ? "in 10 minutes" : win.eta;
      state.orders.push({
        id:"o"+Date.now()+"_"+src, items:items.slice(), total:total, placedAt:Date.now(),
        source:src, stageMs:stageMs, eta:eta,
        courier:COURIERS[Math.floor(Math.random()*COURIERS.length)], unboxed:false
      });
    });
    state.saved+=grandTotal;
    state.resisted+=1;
    state.items+=state.cart.length;
    state.maxItem=Math.max(state.maxItem, maxI);
    markDay();
    state.cart=[];
    save(); renderAll();
    showCheckoutModal(grandTotal);
    burstConfetti();
  }
  function showCheckoutModal(total){
    var ov=document.createElement("div"); ov.className="overlay";
    ov.innerHTML='<div class="modal"><div class="m-emoji">🎉</div><h2>Order placed!</h2>'+
      '<div class="m-saved">'+money(total)+'</div><div class="m-sub">stayed in your pocket. Same rush, zero regret.</div>'+
      '<button class="btn accent block" id="trackNow">Track my delivery 🚚</button></div>';
    document.body.appendChild(ov);
    var close=function(go){ ov.remove(); if(go) switchTab("orders"); };
    el("trackNow").addEventListener("click",function(){ close(true); });
    ov.addEventListener("click",function(e){ if(e.target===ov) close(false); });
  }

  /* real-world delivery durations (used when speedMode === "real") */
  function realDurationMs(source, winKey){
    if(source==="quick") return 10*60000;            // Quick = real 10 minutes
    var now=new Date(), t=new Date(now);
    if(winKey==="asap"){ return 15*60000; }          // ~15 min
    if(winKey==="tonight"){ t.setHours(21,0,0,0); if(t<=now) t.setDate(t.getDate()+1); }
    else if(winKey==="tomorrow"){ t.setDate(t.getDate()+1); t.setHours(18,0,0,0); }
    else { t.setDate(t.getDate()+2); t.setHours(14,0,0,0); } // 2 days
    return Math.max(15*60000, t.getTime()-now.getTime());
  }

  /* ---------- orders ---------- */
  function findOrder(id){ for(var i=0;i<state.orders.length;i++){ if(state.orders[i].id===id) return state.orders[i]; } return null; }
  function etaLabel(stage, stageMs){ var secs=Math.ceil((stageMs*(4-stage))/1000); return "~"+secs+"s (demo)"; }

  /* ---------- 'still want it' → real buy flow ---------- */
  function showBuyFlow(id){
    var o=findOrder(id); if(!o || o.bought) return;
    var items=o.items.slice(0,6).map(function(x){ return '<div class="bi">'+pimg(x)+'</div>'; }).join("");
    var ov=document.createElement("div"); ov.className="overlay";
    ov.innerHTML='<div class="modal"><div class="m-emoji">🤔</div><h2>Still want it?</h2>'+
      '<div class="buy-items">'+items+'</div>'+
      '<div class="buy-reframe">You waited through the whole delivery and it still calls to you — maybe it\'s real, not just an impulse. Buying spends <b>'+money(o.total)+'</b> of your <b>'+money(state.saved)+'</b> saved.</div>'+
      '<div class="buy-actions">'+
        '<button class="btn accent block" id="keepBtn">I\'ll keep my '+money(o.total)+' 💚</button>'+
        '<button class="btn ghost block" id="buyRealBtn">Buy it for real →</button>'+
      '</div>'+
      '<div class="buy-foot">If you buy, Cartharsis earns a small affiliate commission — that\'s how we stay free &amp; ad-light. We only ever suggest buying what survived the craving.</div></div>';
    document.body.appendChild(ov);
    var close=function(){ ov.remove(); };
    ov.addEventListener("click",function(e){ if(e.target===ov) close(); });
    el("keepBtn").addEventListener("click",function(){ close(); toast("💚 Smart. "+money(o.total)+" stays yours."); });
    el("buyRealBtn").addEventListener("click",function(){ close(); confirmRealBuy(o); });
  }
  function confirmRealBuy(o){
    if(o.bought) return;
    o.bought=true;
    state.saved=Math.max(0, state.saved - o.total);
    state.spent=(state.spent||0)+o.total;
    state.bought=(state.bought||0)+1;
    save(); renderAll();
    var ov=document.createElement("div"); ov.className="overlay";
    ov.innerHTML='<div class="modal"><div class="m-emoji">✅</div><h2>Bought for real</h2>'+
      '<div class="m-sub" style="margin-top:10px">This one you genuinely wanted — after the wait, not on impulse. That\'s a mindful purchase, not a regret.<br><br>'+
      '<span style="font-size:.74rem">(In the real app this opens the retailer via an affiliate link.)</span></div>'+
      '<button class="btn accent block" id="okBuy">Got it</button></div>';
    document.body.appendChild(ov);
    var close=function(){ ov.remove(); };
    ov.addEventListener("click",function(e){ if(e.target===ov) close(); });
    el("okBuy").addEventListener("click",close);
  }

  /* ---------- viral share card ---------- */
  function copyText(t){ try{ if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(t); return true; } }catch(e){} return false; }
  function showShareCard(){
    var caps=[
      "Retail therapy. Zero regret. 😌",
      "Cart bhari, wallet safe. 😎",
      "Impulse: 0. Me: winning. 💪",
      "Dopamine liya, paisa bachaya. ✨",
      "Fake-shopped my way to real savings 🛍️💚"
    ];
    var cap=caps[Math.floor(Math.random()*caps.length)];
    var shareText=cap+" Saved "+money(state.saved)+" by fake-shopping on Cartharsis. cartharsis.app";
    var ov=document.createElement("div"); ov.className="share-ov";
    ov.innerHTML='<div class="share-wrap">'+
      '<div class="share-card">'+
        '<div class="sc-deco d1">🛍️</div><div class="sc-deco d2">💸</div><div class="sc-deco d3">🎉</div>'+
        '<div class="sc-brand"><span class="dot"></span> Cartharsis</div>'+
        '<div class="sc-mid"><div class="sc-eyebrow">Money I didn\'t spend</div>'+
          '<div class="sc-hero">'+money(state.saved)+'</div>'+
          '<div class="sc-line">'+cap+'</div></div>'+
        '<div class="sc-stats">'+
          '<div class="sc-stat"><b>'+state.resisted+'</b><span>cravings beaten</span></div>'+
          '<div class="sc-stat"><b>'+streak()+'</b><span>day streak</span></div>'+
          '<div class="sc-stat"><b>'+state.items+'</b><span>fake-bought</span></div>'+
        '</div>'+
        '<div class="sc-foot">Shop the feeling. Keep the cash. 🛒<br><b>cartharsis.app</b></div>'+
      '</div>'+
      '<div class="share-actions">'+
        '<button class="btn accent block" id="shareNow">Share to Story / WhatsApp</button>'+
        '<button class="btn ghost block" id="copyCap" style="color:#fff;border-color:rgba(255,255,255,.4)">Copy caption</button>'+
        '<button class="btn ghost block" id="closeShare" style="color:rgba(255,255,255,.85);border-color:transparent">Close</button>'+
      '</div>'+
      '<div class="share-note">In the real app this saves the card as an image to share anywhere.</div>'+
    '</div>';
    document.body.appendChild(ov);
    var close=function(){ ov.remove(); };
    ov.addEventListener("click",function(e){ if(e.target===ov) close(); });
    el("closeShare").addEventListener("click",close);
    el("copyCap").addEventListener("click",function(){ copyText(shareText); toast("📋 Caption copied!"); });
    el("shareNow").addEventListener("click",function(){
      var done=false;
      try{ if(navigator.share){ navigator.share({title:"Cartharsis", text:shareText, url:"https://cartharsis.app"}); done=true; } }catch(e){}
      if(!done){ copyText(shareText); toast("📋 Caption copied! (Real app shares the image)"); }
    });
  }

  /* ---------- onboarding ---------- */
  function animateNum(node, to){
    var t0=Date.now(), dur=1200;
    (function step(){
      var p=Math.min(1,(Date.now()-t0)/dur);
      var eased=1-Math.pow(1-p,3);
      node.textContent=money(Math.round(to*eased));
      if(p<1) requestAnimationFrame(step);
    })();
  }
  function showOnboarding(){
    var step=1, profile={monthly:9000, regret:""};
    var IMPULSE=[
      {e:"🪙",label:"₹1,000 se kam",val:800},
      {e:"💵",label:"₹1,000 – ₹5,000",val:3000},
      {e:"💸",label:"₹5,000 – ₹15,000",val:9000},
      {e:"🤑",label:"₹15,000+",val:20000}
    ];
    var REGRET=[{e:"😅",label:"Kabhi-kabhi"},{e:"😬",label:"Aksar"},{e:"😭",label:"Har baar!"}];
    var ov=document.createElement("div"); ov.className="onb"; document.body.appendChild(ov);

    function dots(){ var d=""; for(var i=1;i<=3;i++) d+='<div class="onb-dot'+(i===step?' on':'')+'"></div>'; return d; }
    function finish(){ state.onboarded=true; state.profile=profile; save(); ov.remove(); switchTab("shop"); toast("Chalo, koi bhi cheez cart me daalo 🛒"); }

    function render(){
      var body="";
      if(step===0){
        body='<div class="onb-welcome-emoji">🛒</div>'+
          '<div class="onb-q">Shopping ka craving? Isse safely nikaalo.</div>'+
          '<div class="onb-sub">Cart bharo, checkout karo, wahi rush lo — bina ek rupaya kharch kiye. Pehle 30 sec me dekhte hain tumhe kitna faayda hoga.</div>'+
          '<button class="onb-cta" data-next>Shuru karo →</button>';
      }else if(step===1){
        body='<div class="onb-q">Mahine me impulse shopping pe kitna udta hai?</div>'+
          '<div class="onb-sub">Wo cheezein jo plan nahi thi — bas mann kiya toh le liya.</div>'+
          '<div class="onb-opts">'+IMPULSE.map(function(o,i){return '<button class="onb-opt" data-imp="'+i+'"><span class="oe">'+o.e+'</span>'+o.label+'</button>';}).join("")+'</div>';
      }else if(step===2){
        body='<div class="onb-q">Kitni baar kharid ke regret hua?</div>'+
          '<div class="onb-sub">Sach batao — koi judge nahi kar raha. 😌</div>'+
          '<div class="onb-opts">'+REGRET.map(function(o,i){return '<button class="onb-opt" data-reg="'+i+'"><span class="oe">'+o.e+'</span>'+o.label+'</button>';}).join("")+'</div>';
      }else{
        body='<div class="onb-sub" style="margin-bottom:6px">Is hisaab se, ek saal me tum...</div>'+
          '<div class="onb-hero-num" id="onbNum">₹0</div>'+
          '<div class="onb-q" style="font-size:1.15rem;margin-bottom:14px">...impulse pe uda sakte ho. 😳</div>'+
          '<div class="onb-sub">Cartharsis se ye tumhaari jeb me reh sakta hai. Har craving yahan nikaalo — rush milega, paisa bachega.</div>'+
          '<button class="onb-cta" data-finish>Chalo, pehla craving nikaalte hain →</button>';
      }
      ov.innerHTML='<div class="onb-top"><div class="onb-brand"><span class="dot"></span> Cartharsis</div>'+
        (step<3?'<button class="onb-skip" data-skip>Skip</button>':'')+'</div>'+
        '<div class="onb-dots">'+dots()+'</div>'+
        '<div class="onb-body">'+body+'</div>';

      var nx=ov.querySelector("[data-next]"); if(nx) nx.addEventListener("click",function(){ step=1; render(); });
      var sk=ov.querySelector("[data-skip]"); if(sk) sk.addEventListener("click",finish);
      ov.querySelectorAll("[data-imp]").forEach(function(b){ b.addEventListener("click",function(){ profile.monthly=IMPULSE[+b.dataset.imp].val; step=2; render(); }); });
      ov.querySelectorAll("[data-reg]").forEach(function(b){ b.addEventListener("click",function(){ profile.regret=REGRET[+b.dataset.reg].label; step=3; render(); }); });
      var fn=ov.querySelector("[data-finish]"); if(fn) fn.addEventListener("click",finish);
      var num=ov.querySelector("#onbNum"); if(num) animateNum(num, profile.monthly*12);
    }
    render();
  }

  function renderOrders(){
    var list=el("ordersList");
    if(state.orders.length===0){
      list.innerHTML='<div class="empty"><div class="big">📭</div><h3>Nothing shipping yet</h3><p>Checkout a cart and watch it travel to you.</p></div>';
      return;
    }
    var now=Date.now(), html="";
    state.orders.slice().reverse().forEach(function(o){
      var cfg=DELIVERY[o.source||"store"];
      var stageMs=o.stageMs||cfg.stageMs;
      var ratio=stageMs/cfg.stageMs;
      var courier=o.courier||{name:"Your courier",e:"🛵"};
      var elapsed=now-o.placedAt;
      var stage=Math.min(4, Math.floor(elapsed/stageMs));
      var pct=Math.min(100,(elapsed/(stageMs*4))*100);
      var delivered=stage>=4;
      var names=o.items.map(function(x){return x.name}).join(", ");
      var itemCount=o.items.length;
      var srcPill = o.source==="quick" ? '<span class="src-pill quick">⚡ Quick</span>' : '<span class="src-pill store">📦 Store</span>';

      var steps=cfg.stages.map(function(sg,si){
        var cls = si<stage ? "done" : (si===stage&&!delivered ? "current" : (si===4&&delivered ? "done" : ""));
        return '<div class="step '+cls+'"><div class="ic">'+sg.ic+'</div><div class="st">'+sg.st+'</div></div>';
      }).join("");

      var etaTxt = delivered ? '🎉 Delivered — and you spent nothing' : '🕐 Arriving '+(o.eta||etaLabel(stage,stageMs))+' · '+cfg.stages[stage].st;

      var feed="";
      var unlocked=cfg.flow.filter(function(f){ return elapsed>=f.t*ratio; });
      unlocked.forEach(function(f){
        // clock shows the REAL schedule (disp minutes), not the sped-up demo time
        var when = f.disp!=null ? o.placedAt + f.disp*60000 : o.placedAt + f.t*ratio;
        var clock=new Date(when).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
        if(f.type==="system") feed+='<div class="msg system"><div class="bubble">'+f.m+'</div></div>';
        else feed+='<div class="msg"><div class="m-av">'+courier.e+'</div><div class="bubble">'+f.m+'<span class="time">'+clock+'</span></div></div>';
      });
      if(!delivered && unlocked.length<cfg.flow.length)
        feed+='<div class="msg typing"><div class="m-av">'+courier.e+'</div><div class="bubble">'+courier.name+' is typing…</div></div>';

      var tail="";
      if(delivered && !o.unboxed){
        tail='<div class="unbox-cta"><button class="unbox-btn" data-unbox="'+o.id+'"><span class="bx">📦</span>Tap to unbox</button></div>';
      }else if(delivered && o.unboxed){
        var revItems=o.items.slice(0,6).map(function(x,ix){
          return '<div class="r-item" style="animation-delay:'+(ix*0.08)+'s">'+pimg(x)+'</div>';
        }).join("");
        var revActions = o.bought
          ? '<div class="db-actions"><div class="bought-line">✅ Bought for real — a mindful purchase</div></div>'
          : '<div class="db-actions"><button class="btn accent" data-done="'+o.id+'">Didn\'t need it 💪</button>'+
            '<button class="btn ghost" data-buy="'+o.id+'">Still want it →</button></div>';
        tail='<div class="reveal"><div class="r-items">'+revItems+'</div><div class="r-title">Unboxed! 🎊</div>'+
             '<div class="r-sub">Full rush. You kept <b>'+money(o.total)+'</b>.</div>'+revActions+'</div>';
      }

      html+='<div class="order" data-oid="'+o.id+'">'+
        '<div class="order-head"><div><div class="oh-items">'+srcPill+itemCount+' item'+(itemCount>1?'s':'')+'</div>'+
        '<div class="oh-meta">'+esc(names)+'</div></div>'+
        '<div class="oh-saved"><div class="s">'+money(o.total)+'</div><div class="l">saved</div></div></div>'+
        '<div class="eta '+(delivered?'done':'')+'">'+etaTxt+'</div>'+
        '<div class="track"><div class="bar"><div class="fill" style="width:'+pct+'%"></div></div>'+steps+'</div>'+
        '<div class="courier"><div class="cav">'+courier.e+'<span class="live"></span></div>'+
        '<div><div class="cname">'+courier.name+'</div><div class="crole">'+cfg.role+'</div></div></div>'+
        '<div class="feed">'+feed+'</div>'+tail+'</div>';
    });
    list.innerHTML=html;
    list.querySelectorAll("[data-unbox]").forEach(function(b){
      b.addEventListener("click",function(){ var o=findOrder(b.dataset.unbox); if(o){ o.unboxed=true; save(); burstConfetti(); renderOrders(); } });
    });
    list.querySelectorAll("[data-buy]").forEach(function(b){
      b.addEventListener("click",function(){ showBuyFlow(b.dataset.buy); });
    });
    list.querySelectorAll("[data-done]").forEach(function(b){
      b.addEventListener("click",function(){ toast("💪 Respect. That's a real win."); b.closest(".order").style.opacity=".55"; });
    });
  }

  /* ---------- you ---------- */
  function renderYou(){
    el("statSaved").textContent=money(state.saved);
    el("statResist").textContent=state.resisted;
    el("statItems").textContent=state.items;
    el("statStreak").textContent=streak();
    var mc=el("mindfulCard");
    if((state.bought||0)>0){
      mc.innerHTML='<div class="mindful-card"><div class="mc-ic">🧘</div><div><div class="mc-t">'+state.bought+' mindful purchase'+(state.bought>1?'s':'')+'</div>'+
        '<div class="mc-s">'+money(state.spent||0)+' spent on things you truly wanted — after the wait, not on impulse.</div></div></div>';
    }else{
      mc.innerHTML='<div class="mindful-card"><div class="mc-ic">💪</div><div><div class="mc-t">0 real purchases yet</div>'+
        '<div class="mc-s">You\'ve resisted every craving so far. Legend.</div></div></div>';
    }
    renderSpeed();
    var s={resisted:state.resisted, saved:state.saved, maxItem:state.maxItem, streak:streak(), bought:state.bought||0};
    var b=el("badges"); b.innerHTML="";
    BADGES.forEach(function(bd){
      var got=bd.test(s);
      var row=document.createElement("div"); row.className="badge"+(got?"":" locked");
      row.innerHTML='<div class="b-ic">'+(got?bd.ic:"🔒")+'</div><div><div class="b-name">'+bd.name+'</div><div class="b-desc">'+bd.desc+'</div></div>';
      b.appendChild(row);
    });
  }

  function renderSpeed(){
    var c=el("speedOpts"); if(!c) return; c.innerHTML="";
    var opts=[
      {k:"demo", t:"⚡ Demo (fast)", d:"Test the whole flow in seconds"},
      {k:"real", t:"🕐 Real time", d:"Quick = real 10 min · Store = your chosen window (up to 2 days)"}
    ];
    var cur=state.speedMode||"demo";
    opts.forEach(function(o){
      var b=document.createElement("button");
      b.className="speed-opt"+(o.k===cur?" active":"");
      b.innerHTML=o.t+'<small>'+o.d+'</small>';
      b.addEventListener("click",function(){
        state.speedMode=o.k; save(); renderSpeed();
        toast(o.k==="real" ? "🕐 Real-time ON — ab delivery asli time legi" : "⚡ Demo speed ON — fast testing");
      });
      c.appendChild(b);
    });
  }

  /* ---------- confetti ---------- */
  function burstConfetti(){
    if(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var cv=el("confetti"); cv.hidden=false;
    var ctx=cv.getContext("2d"); var dpr=window.devicePixelRatio||1;
    cv.width=innerWidth*dpr; cv.height=innerHeight*dpr; ctx.scale(dpr,dpr);
    var cols=["#0f9d6b","#f0663b","#e0a52e","#6c8cff","#d15a8a"]; var parts=[];
    for(var i=0;i<130;i++){ parts.push({x:innerWidth/2+(Math.random()-.5)*120,y:innerHeight*0.35,
      vx:(Math.random()-.5)*11,vy:Math.random()*-13-4,s:Math.random()*7+4,c:cols[i%cols.length],r:Math.random()*6,vr:(Math.random()-.5)*.4}); }
    var t0=Date.now();
    (function frame(){
      var dt=Date.now()-t0; ctx.clearRect(0,0,innerWidth,innerHeight);
      parts.forEach(function(p){ p.vy+=.45; p.x+=p.vx; p.y+=p.vy; p.r+=p.vr;
        ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.r); ctx.fillStyle=p.c; ctx.fillRect(-p.s/2,-p.s/2,p.s,p.s*.6); ctx.restore(); });
      if(dt<2600) requestAnimationFrame(frame); else { ctx.clearRect(0,0,innerWidth,innerHeight); cv.hidden=true; }
    })();
  }

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(msg){
    var old=document.querySelector(".toast"); if(old) old.remove();
    var t=document.createElement("div"); t.className="toast"; t.textContent=msg; document.body.appendChild(t);
    clearTimeout(toastTimer); toastTimer=setTimeout(function(){ t.remove(); },2600);
  }

  /* ---------- push notifications (simulated) ---------- */
  var pushTimer;
  function pushNotify(text){
    var b=el("pushBanner");
    b.hidden=true;
    b.innerHTML='<div class="pb-ic">🛒</div><div><div class="pb-app">Cartharsis · now</div><div class="pb-msg">'+text+'</div></div>';
    void b.offsetWidth;
    b.hidden=false;
    b.onclick=function(){ b.hidden=true; switchTab("orders"); };
    clearTimeout(pushTimer); pushTimer=setTimeout(function(){ b.hidden=true; },4500);
    try{ if(navigator.vibrate) navigator.vibrate(30); }catch(e){}
  }
  var lastStages={};
  function currentStage(o){
    var cfg=DELIVERY[o.source||"store"]; var stageMs=o.stageMs||cfg.stageMs;
    return Math.min(4, Math.floor((Date.now()-o.placedAt)/stageMs));
  }
  function initStages(){ state.orders.forEach(function(o){ lastStages[o.id]=currentStage(o); }); }
  function checkPushes(){
    state.orders.forEach(function(o){
      var cfg=DELIVERY[o.source||"store"];
      var st=currentStage(o);
      var prev=lastStages[o.id];
      if(prev===undefined){ lastStages[o.id]=st; return; }
      while(prev<st){ prev++; var txt=cfg.push&&cfg.push[prev]; if(txt) pushNotify(txt); }
      lastStages[o.id]=st;
    });
  }

  /* ---------- tabs ---------- */
  function ordersSig(){
    var now=Date.now();
    return state.orders.map(function(o){
      var cfg=DELIVERY[o.source||"store"]; var stageMs=o.stageMs||cfg.stageMs; var ratio=stageMs/cfg.stageMs; var elapsed=now-o.placedAt;
      var stage=Math.min(4,Math.floor(elapsed/stageMs));
      var unlocked=cfg.flow.filter(function(f){ return elapsed>=f.t*ratio; }).length;
      return o.id+":"+stage+":"+unlocked+":"+(o.unboxed?1:0);
    }).join("|");
  }
  var lastSig="";
  function switchTab(name){
    document.querySelectorAll(".screen").forEach(function(s){ s.classList.toggle("active", s.id===name); });
    document.querySelectorAll(".nav button").forEach(function(b){ b.classList.toggle("active", b.dataset.tab===name); });
    if(name==="orders"){ renderOrders(); lastSig=ordersSig(); }
    if(name==="you") renderYou();
    window.scrollTo(0,0);
  }
  function renderAll(){ renderTop(); renderCart(); renderNav(); renderOrders(); renderYou(); }

  /* ---------- wire ---------- */
  document.querySelectorAll(".nav button").forEach(function(b){ b.addEventListener("click",function(){ switchTab(b.dataset.tab); }); });
  document.querySelectorAll(".mode-toggle button").forEach(function(b){ b.addEventListener("click",function(){ setMode(b.dataset.mode); }); });
  el("storeSearch").addEventListener("input",function(e){ storeQuery=e.target.value; searchResults=null; renderStore(); });
  el("storeSearch").addEventListener("keydown",function(e){ if(e.key==="Enter"){ e.preventDefault(); liveSearch(e.target.value); } });
  el("storeSearchBtn").addEventListener("click",function(){ liveSearch(el("storeSearch").value); });
  el("addCraving").addEventListener("click",function(){
    var name=el("cName").value.trim(); var price=parseFloat(el("cPrice").value);
    if(!name){ toast("Type what you're craving first"); el("cName").focus(); return; }
    if(!price||price<=0){ toast("Add a price so you can see what you save"); el("cPrice").focus(); return; }
    addToCart({name:name, price:price, emoji:"🔥", source:"store"});
    el("cName").value=""; el("cPrice").value="";
  });
  el("checkoutBtn").addEventListener("click",checkout);
  el("shareBtn").addEventListener("click",showShareCard);
  el("startBtn").addEventListener("click",function(){
    var s=el("splash"); if(s) s.hidden=true;
    if(!state.onboarded) showOnboarding();
  });
  el("resetBtn").addEventListener("click",function(){
    if(confirm("Reset all your Cartharsis data?")){
      var keepSpeed=state.speedMode||"demo";
      state={cart:[],orders:[],saved:0,resisted:0,items:0,maxItem:0,days:[],spent:0,bought:0,onboarded:false,profile:null,speedMode:keepSpeed};
      save(); renderAll(); switchTab("shop"); showOnboarding();
    }
  });

  /* ---------- boot: load catalog from backend, then start ---------- */
  function uniqueCats(list){
    var seen={}, out=[];
    list.forEach(function(it){ if(it.cat && !seen[it.cat]){ seen[it.cat]=1; out.push(it.cat); } });
    return out;
  }
  function applyCatalog(data){
    QUICK = data.quick || [];
    STORE = data.store || [];
    DEPTS = data.depts || [];
    TRENDING = data.trending || [];
    QUICK_CAT = ["All"].concat(uniqueCats(QUICK));
    lastUpdated = data.updated || Math.floor(Date.now()/1000);
    if(typeof data.live !== "undefined") AMZ_LIVE = !!data.live;
  }
  function refreshCatalog(){
    fetch("/api/catalog").then(function(r){ return r.json(); }).then(function(data){
      applyCatalog(data);
      // live, non-disruptive update
      if(shopMode==="store" && !el("storeView").hidden){
        renderTrending();
        if(!storeQuery){ renderStoreChips(); renderStore(); }
      }
      if(shopMode==="quick" && !el("quickView").hidden){ renderChips(); renderQuick(); }
    }).catch(function(){});
  }
  function boot(){
    renderChips();
    setMode("quick");
    renderAll();
    initStages();
    setInterval(function(){
      checkPushes();
      if(document.getElementById("orders").classList.contains("active")){
        var sig=ordersSig(); if(sig!==lastSig){ lastSig=sig; renderOrders(); }
      }
      renderTop();
      var ua=el("updatedAgo"); if(ua) ua.textContent=agoLabel(lastUpdated);
      var ll=el("liveLabel"); if(ll) ll.textContent = AMZ_LIVE ? "Live" : "Demo";
    },1000);
    setInterval(refreshCatalog, 30000); // poll every 30s: picks up live Amazon once it's ready + keeps trending fresh
    // welcome + onboarding is triggered from the splash Start button
  }

  fetch("/api/catalog").then(function(r){ return r.json(); }).then(function(data){
    applyCatalog(data);
    boot();
  }).catch(function(){
    el("quickGrid").innerHTML='<div class="loading">Couldn\'t load catalog. Is the server running?</div>';
    boot();
  });
})();
