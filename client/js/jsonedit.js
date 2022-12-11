let jeEnabled = null;
let jeZoomOut = false;
let jeMode = null;
let jeWidget = null;
let jePlainWidget = null;
let jeStateBefore = null;
let jeStateBeforeRaw = null;
let jeStateNow = null;
let jeJSONerror = null;
let jeCommandError = null;
let jeCommandWithOptions = null;
let jeFKeyOrderDescending = 1;
let jeWidgetHighlighting = true;
let jeDebugViewing = null;
let jeInMacroExecution = false;
let jeContext = null;
let jeSecondaryWidget = null;
let jeDeltaIsOurs = false;
let jeMouseButtonIsDown = false;
let jeKeyIsDown = true;
let jeKeyIsDownDeltas = [];
let jeKeyword = '';
const jeWidgetLayers = {};
const jeState = {
  ctrl: false,
  shift: false,
  mouseX: 0,
  mouseY: 0,
  widget: null
};

const jeMacroPreset = `
// this code will be called for
// every widget as variable w

// variable v is a persistent object you
// can use to store other information

// EXAMPLES

// add a property to all cards of a deck
// if(w.deck == "deckName")
//   w.customVariable = true;

// change ID of matching widgets
// var match = w.id.match(/^Player 3 - ((First|Second).*)$/)
// if(match)
//   w.id = "Player 5 - "+match[1]

// move matching widgets to the left
// if(w.id.match(/^Player [13] - (Score|Seat)/))
//   w.x -= 20;

// change all widget IDs to a counter prefixed by "w"
// if(!v.i)
//   v.i = 1
// w.id = "w"+v.i
// v.i++
`;

const jeOrder = [ 'type', 'id#', 'parent', 'fixedParent', 'deck', 'cardType', 'index*', 'owner#', 'x*', 'y*', 'width*', 'height*', 'borderRadius', 'scale', 'rotation#', 'layer', 'z', 'inheritChildZ#', 'movable*', 'movableInEdit*#' ];

const jeCommands = [
  /* Just for editing convenience, the top (command) buttons are listed first */
  {
    id: 'je_toggleZoom',
    name: 'Toggle zoom',
    icon: '[zoom_in]',
    forceKey: 'Z',
    classes: _=>jeZoomOut ? 'onState' : '',
    call: async function() {
      jeZoomOut = !jeZoomOut;
      if(jeZoomOut) {
        $('body').classList.add('jeZoomOut');
      } else {
        $('body').classList.remove('jeZoomOut');
      }
      setScale();
    }
  },
  {
    id: 'je_copyState',
    name: 'Copy state from another room/server',
    icon: '[import_room]',
    forceKey: 'C',
    options: [ { type: 'string', label: 'URL' } ],
    call: async function(options) {
      const sourceURL = options.URL.replace(/\/[^\/]+$/, a=>`/state${a}`);
      const targetURL = location.href.replace(/\/[^\/]+$/, a=>`/state${a}`);
      fetch(sourceURL).then(r=>r.text()).then(t=>{
        fetch(targetURL,{
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: t
        })
      });
    }
  },
  {
    id: 'je_callMacro',
    name: _=>jeMode == 'macro' ? 'Call' : 'Macro',
    icon: _=>jeMode == 'macro' ? '[play_arrow]' : '[routine]',
    forceKey: 'M',
    call: async function() {
      if(jeMode != 'macro') {
        jeWidget = null;
        jeMode = 'macro';
        jeSetEditorContent(jeMacroPreset);
        jeColorize();
        editPanel.style.setProperty('--treeHeight', "20%");
      } else {
        jeJSONerror = null;
        jeInMacroExecution = true;
        try {
          const macro = new Function(`"use strict";return (function(w, v) {${jeGetEditorContent()}})`)();
          const variableState = {};
          for(const w of [...widgets.values()]) { // shallow copy because we might create new widgets by changing the id
            const s = JSON.stringify(w.state);
            const newState = JSON.parse(s);
            macro(newState, variableState);
            await updateWidget(JSON.stringify(newState), s);
          }
        } catch(e) {
          jeJSONerror = e;
        }
        jeDisplayTree();
        jeInMacroExecution = false;
      }
      jeShowCommands();
    }
  },
  {
    id: 'je_showWidget',
    name: 'Show this widget below',
    icon: '[visibility]',
    forceKey: 'S',
    call: async function() {
      if(jeMode == 'multi')
        jeSecondaryWidget = jeGetEditorContent();
      else if(jeWidget !== undefined && jeWidget && (jeSecondaryWidget === null || jeStateNow.id != JSON.parse(jeSecondaryWidget).id))
        jeSecondaryWidget = JSON.stringify(jeWidget.state, null, '  ');
      else
        jeSecondaryWidget = null;
      jeShowCommands();
    }
  },
  {
    id: 'je_reverseFkeys',
    name: 'Reverse order of F-key shortcuts',
    icon:  _=>jeFKeyOrderDescending ==1 ? '[arrow_down]' : '[arrow_up]',
    forceKey: 'K',
    call: async function() {
      jeFKeyOrderDescending = -jeFKeyOrderDescending;
      jeShowCommands();
    }
  },
  {
    id: 'je_addNewWidget',
    name: 'Add new widget',
    icon: '[add_circle]',
    forceKey: 'A',
    call: async function() {
      showOverlay("addOverlay")
    }
  },
  {
    id: 'je_removeWidget',
    name: 'Remove widget',
    icon: '[remove_circle]',
    forceKey: 'R',
    show: _=>jeStateNow,
    call: async function() {
      batchStart();
      for(const id of jeSelectedIDs())
        await removeWidgetLocal(id);
      batchEnd();
      jeEmpty();
    }
  },
  {
    id: 'je_duplicateWidget',
    name: 'Duplicate widget',
    icon: '[auto_awesome]',
    forceKey: 'D',
    show: _=>jeStateNow,
    options: [
      { label: 'Increment IDs',          type: 'select', options: [ { value: 'Numbers', text: 'Numbers' }, { value: 'Letters', text: 'Letters' }, { value: '', text: 'None'  } ] },
      { label: 'Increment In',           type: 'string',   value: 'dropTarget,hand,index,inheritFrom,linkedToSeat,onlyVisibleForSeat,text' },
      { label: 'Copy using inheritFrom', type: 'checkbox', value: false },
      { label: 'Inherit properties',     type: 'string', value: '' },
      { label: 'Copy recursively',       type: 'checkbox', value: true  },
      { label: 'X offset',               type: 'number',   value: 0,   min: -1600, max: 1600 },
      { label: 'Y offset',               type: 'number',   value: 0,   min: -1000, max: 1000 },
      { label: '# Copies X',             type: 'number',   value: 1,   min:     0, max:  100 },
      { label: '# Copies Y',             type: 'number',   value: 0,   min:     0, max:  100 }
    ],
    call: async function(options) {
      for(const id of jeSelectedIDs()) {
        const problems = [];
        const clonedWidget = await duplicateWidget(widgets.get(id), options['Copy recursively'], options['Copy using inheritFrom'], options['Inherit properties'].split(',').map(e => e.trim()),options['Increment IDs'], options['Increment In'].split(','), options['X offset'], options['Y offset'], options['# Copies X'], options['# Copies Y'], problems);
        if(problems.length)
          jeJSONerror = problems.join('\n');
        if(clonedWidget) {
          jeSelectWidget(widgets.get(clonedWidget.id));
          jeStateNow.id = '###SELECT ME###';
          jeSetAndSelect(clonedWidget.id);
          jeStateNow.id = clonedWidget.id;
        }
      }
    }
  },
  {
    id: 'je_editMode',
    name: 'Edit mode',
    icon: '[edit]',
    forceKey: 'F',
    classes: _=>edit ? 'onState' : '',
    call: async function() {
      toggleEditMode();
    }
  },
  {
    id: 'je_openParent',
    name: 'Open parent',
    icon: '[up_one_level]',
    forceKey: 'ArrowUp',
    show: _=>jeStateNow && widgets.has(jeStateNow.parent),
    call: async function() {
      jeSelectWidget(widgets.get(jeStateNow.parent));
    }
  },
  {
    id: 'je_toggleWide',
    name: 'Toggle wide editor',
    icon: '[width]',
    forceKey: 'ArrowRight',
    classes: _=> $('#jsonEditor').classList.contains('wide') ? 'onState' : '',
    call: async function() {
      $('#jsonEditor').classList.toggle('wide');
      setScale();
      $('#jeTextHighlight').scrollTop = $('#jeText').scrollTop;
      jeDisplayTree();
    }
  },
  {
    id: 'je_toggleHighlight',
    name: 'Toggle widget highlighting',
    icon: 'flashlight_on',
    forceKey: 'H',
    classes: _=> jeWidgetHighlighting ? ' onState' : '',
    call: async function() {
      jeWidgetHighlighting = ! jeWidgetHighlighting;
      jeShowCommands();
      jeHighlightWidgets();
    }
  },
  {
    id: 'je_toggleDebug',
    name: 'Toggle debug information',
    icon: 'pest_control',
    forceKey: 'B',
    classes: _=> jeDebugViewing ? 'onState' : '',
    show: _=>jeDebugViewing != null,
    call: async function() {
      jeDebugViewing = ! jeDebugViewing;
      $('#jeLog').classList.toggle('active');
    }
  },
  /* Now the context-dependent stuff */
  {
    id: 'je_toggleBoolean',
    name: 'toggle boolean',
    context: '.*"(true|false)"',
    call: async function() {
      jeInsert(jeContext.slice(1), jeContext[jeContext.length-2], jeContext[jeContext.length-1]=='"false"');
    }
  },
  {
    id: 'je_colorPicker',
    name: 'change color',
    options: [ { type: 'color', label: 'color' } ],
    context: '.*#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})|^.* ↦ color',
    call: async function(options) {
      if(options['color']) {
        jeInsert(null, jeGetLastKey(), options['color']);
        jeApplyChanges();
      };
    }
  },
  {
    id: 'je_openWidgetById',
    name: 'open widget by ID',
    context: '.*"([^"]+)"',
    call: async function() {
      const m = jeContext.join('').match(/"([^"]+)"/);
      jeSelectWidget(widgets.get(m[1]));
    },
    show: function() {
      const m = jeContext.join('').match(/"([^"]+)"/);
      return widgets.has(m[1]);
    }
  },
  {
    id: 'je_uploadAsset',
    name: 'upload a different asset',
    context: '.*"(/assets/[0-9_-]+)"|^.* ↦ image$|^deck ↦ faceTemplates ↦ [0-9]+ ↦ objects ↦ [0-9]+ ↦ value' + String.fromCharCode(36), // the minifier doesn't like "$" or "\x24" here
    call: async function() {
      uploadAsset().then(a=> {
        if(a) {
          jeInsert(null, jeGetLastKey(), a);
          jeApplyChanges();
        }
      });
    }
  },
  {
    id: 'je_uploadAudio',
    name: 'upload audio file',
    context: '^.*\\(AUDIO\\) ↦ source|^.* ↦ clickSound',
    call: async function() {
      uploadAsset().then(a=> {
        if(a) {
          jeInsert(null, jeGetLastKey(), a);
          jeApplyChanges();
        }
      });
    }
  },
  {
    id: 'je_cardTypeTemplate',
    name: 'card type template',
    context: '^deck ↦ cardTypes',
    call: async function() {
      const cardType = {};
      const cssVariables = {};
      for(const face of jeStateNow.faceTemplates || []) {
        for(const object of face.objects) {
          for(const property in object.dynamicProperties || {})
            cardType[object.dynamicProperties[property]] = '';
          ((object.css || '').match(/--[a-zA-Z]+/g) || []).forEach(m=>cssVariables[`${m}: black`]=true);
        }
      }
      const css = Object.keys(cssVariables).join('; ');
      if(css)
        cardType.css = css;
      jeStateNow.cardTypes['###SELECT ME###'] = cardType;
      jeSetAndSelect(generateUniqueWidgetID());
    }
  },
  {
    id: 'je_addCard',
    name: _=>`add card ${widgetFilter(w=>w.get('deck')==jeStateNow.id&&w.get('cardType')==jeContext[2]).length + 1}`,
    context: '^deck ↦ cardTypes ↦ [^"↦]+',
    call: async function() {
      const card = { deck:jeStateNow.id, type:'card', cardType:jeContext[2] };
      await addWidgetLocal(card);
      if(jeStateNow.parent)
        await widgets.get(card.id).moveToHolder(widgets.get(jeStateNow.parent));
      else
        await widgets.get(card.id).updatePiles();
    }
  },
  {
    id: 'je_addAllCards',
    name: _=>`add one card of all ${Object.keys(jeStateNow.cardTypes).length} cardTypes`,
    context: '^deck ↦ cardTypes',
    show: _=>Object.keys(jeStateNow.cardTypes).length,
    call: async function() {
      for(const cardType in jeStateNow.cardTypes) {
        const card = { deck:jeStateNow.id, type:'card', cardType };
        await addWidgetLocal(card);
        if(jeStateNow.parent)
          await widgets.get(card.id).moveToHolder(widgets.get(jeStateNow.parent));
        else
          await widgets.get(card.id).updatePiles();
      }
    }
  },
  {
    id: 'je_removeCard',
    name: _=>`remove card ${widgetFilter(w=>w.get('deck')==jeStateNow.id&&w.get('cardType')==jeContext[2]).length}`,
    context: '^deck ↦ cardTypes ↦ [^"↦]+',
    show: _=>widgetFilter(w=>w.get('deck')==jeStateNow.id&&w.get('cardType')==jeContext[2]).length,
    call: async function() {
      const card = widgetFilter(w=>w.get('deck')==jeStateNow.id&&w.get('cardType')==jeContext[2])[0];
      await removeWidgetLocal(card.get('id'));
    }
  },
  {
    id: 'je_removeAllCards',
    name: _=>`remove all ${widgetFilter(w=>w.get('deck')==jeStateNow.id).length} cards`,
    context: '^deck ↦ cardTypes',
    show: _=>widgetFilter(w=>w.get('deck')==jeStateNow.id).length,
    call: async function() {
      for(const card of widgetFilter(w=>w.get('deck')==jeStateNow.id))
        await removeWidgetLocal(card.get('id'));
    }
  },
  {
    id: 'je_faceTemplate',
    name: 'face template',
    context: '^deck ↦ faceTemplates',
    call: async function() {
      jeStateNow.faceTemplates.push({
        objects: '###SELECT ME###'
      });
      jeSetAndSelect([]);
    }
  },
  {
    id: 'je_grid',
    name: 'grid element',
    context: '^[^ ]* ↦ grid',
    call: async function() {
      const w = widgets.get(jeStateNow.id);
      jeStateNow.grid.push({
        x: '###SELECT ME###',
        y: w.get('height')
      });
      jeSetAndSelect(w.get('width'));
    }
  },
  {
    id: 'je_imageTemplate',
    name: 'image template',
    context: '^deck ↦ faceTemplates ↦ [0-9]+ ↦ objects',
    call: async function() {
      jeStateNow.faceTemplates[+jeContext[2]].objects.push({
        type: 'image',
        x: 0,
        y: 0,
        color: 'transparent',
        width: jeStateNow.cardDefaults && jeStateNow.cardDefaults.width  || 103,
        height: jeStateNow.cardDefaults && jeStateNow.cardDefaults.height || 160,
        dynamicProperties: {
          value: '###SELECT ME###'
        }
      });
      jeSetAndSelect('image');
    }
  },
  {
    id: 'je_inheritFromString',
    name: 'convert to object',
    context: '^.* ↦ inheritFrom',
    show:  _=>typeof jeStateNow.inheritFrom == "string",
    call: async function() {
      const w = jeStateNow.inheritFrom;
      jeStateNow.inheritFrom = {};
      jeStateNow.inheritFrom[w] = '###SELECT ME###';
      jeSetAndSelect("*");
    }
  },
  {
    id: 'je_inheritFromObject',
    name: 'add field',
    context: '^.* ↦ inheritFrom',
    show:  _=>typeof jeStateNow.inheritFrom == "object" && jeStateNow.inheritFrom[""]==undefined,
    call: async function() {
      jeStateNow.inheritFrom["###SELECT ME###"] = [""];
      jeSetAndSelect("");
    }
  },
  {
    id: 'je_cssString',
    name: 'convert to simple object',
    context: '^.* ↦ (css|[a-z]+CSS)',
    show: function() {
      const cssKind = jeContext.join(' ↦ ').match(this.context)[1];
      return typeof jeStateNow[cssKind] == "string";
    },
    call: async function() {
      const cssKind = jeContext.join(' ↦ ').match(this.context)[1];
      const elements = jeStateNow[cssKind].split(/[;:]/);
      if(elements.length > 1) {
        const selectedKey = elements[0];
        elements[0] = "###SELECT ME###";
        jeStateNow[cssKind] = {};
        for( let i=0; i<Math.floor(elements.length/2); i++)
          jeStateNow[cssKind][elements[2*i].trim()] = elements[2*i+1].trim();
        jeSetAndSelect(selectedKey.trim())
      } else {
        jeStateNow[cssKind] = '###SELECT ME###';
        jeSetAndSelect({});
      }
    }
  },
  {
    id: 'je_cssObject',
    name: 'convert to nested object',
    context: '^.* ↦ css',
    show:  function() {
      if(typeof jeStateNow.css != "object" || jeStateNow.css === null)
        return false;
      for(const property in jeStateNow.css)
        if(typeof jeStateNow.css[property] == "object")
          return false;
      return true;
    },
    call: async function() {
      jeStateNow.css = { '###SELECT ME###': jeStateNow.css };
      jeSetAndSelect("default");
    }
  },
  {
    id: 'je_textTemplate',
    name: 'text template',
    context: '^deck ↦ faceTemplates ↦ [0-9]+ ↦ objects',
    call: async function() {
      jeStateNow.faceTemplates[+jeContext[2]].objects.push({
        type: 'text',
        x: 0,
        y: 0,
        fontSize: 20,
        textAlign: 'center',
        width: jeStateNow.cardDefaults && jeStateNow.cardDefaults.width  || 103,
        dynamicProperties: {
          value: '###SELECT ME###'
        }
      });
      jeSetAndSelect('text');
    }
  },
  {
    id: 'je_inputField',
    name: 'add field',
    context: '^.* ↦ \\(INPUT\\) ↦ fields',
    call: jeRoutineCall(function(routineIndex, routine, operationIndex, operation) {
      jeGetValue(jeContext.slice(1, routineIndex+4)).push( { type: "###SELECT ME###" } );
      jeSetAndSelect('string');
    })
  },
  {
    id: 'je_classes',
    name: 'classes',
    context: '^deck ↦ faceTemplates ↦ [0-9]+ ↦ objects ↦ [0-9]+',
    show: _=>!jeStateNow.faceTemplates[+jeContext[2]].objects[+jeContext[4]].classes,
    call: async function() {
      jeStateNow.faceTemplates[+jeContext[2]].objects[+jeContext[4]].classes = '###SELECT ME###';
      jeSetAndSelect('');
    }
  },
  {
    id: 'je_faceTemplate_css',
    name: 'css',
    context: '^deck ↦ faceTemplates ↦ [0-9]+ ↦ objects ↦ [0-9]+',
    show: _=>!jeStateNow.faceTemplates[+jeContext[2]].objects[+jeContext[4]].css,
    call: async function() {
      jeStateNow.faceTemplates[+jeContext[2]].objects[+jeContext[4]].css = '###SELECT ME###';
      jeSetAndSelect({});
    }
  },
  {
    id: 'je_rotation',
    name: 'rotation',
    context: '^deck ↦ faceTemplates ↦ [0-9]+ ↦ objects ↦ [0-9]+',
    show: _=>!jeStateNow.faceTemplates[+jeContext[2]].objects[+jeContext[4]].rotation,
    call: async function() {
      jeStateNow.faceTemplates[+jeContext[2]].objects[+jeContext[4]].rotation = '###SELECT ME###';
      jeSetAndSelect(0);
    }
  },
  {
    id: 'je_dynamicProperties',
    name: 'dynamicProperties',
    context: '^deck ↦ faceTemplates ↦ [0-9]+ ↦ objects ↦ [0-9]+',
    show: _=>!jeStateNow.faceTemplates[+jeContext[2]].objects[+jeContext[4]].dynamicProperties,
    call: async function() {
      jeStateNow.faceTemplates[+jeContext[2]].objects[+jeContext[4]].dynamicProperties = { "###SELECT ME###": "" };
      jeSetAndSelect('');
    }
  },
  {
    id: 'je_toggleDynamicValue',
    name: _=>(jeStateNow.faceTemplates[+jeContext[2]].objects[+jeContext[4]].dynamicProperties || {}).value ? 'static value' : 'dynamic value',
    context: '^deck ↦ faceTemplates ↦ [0-9]+ ↦ objects ↦ [0-9]+',
    call: async function() {
      const o = jeStateNow.faceTemplates[+jeContext[2]].objects[+jeContext[4]];
      const d = !!(o.dynamicProperties || {}).value;
      const v = d ? o.dynamicProperties.value : o.value;
      if(d) {
        delete o.dynamicProperties.value;
        if(!Object.keys(o.dynamicProperties).length)
          delete o.dynamicProperties;
        o.value = '###SELECT ME###';
      } else {
        delete o.value;
        if(!o.dynamicProperties)
          o.dynamicProperties = {};
        o.dynamicProperties.value = '###SELECT ME###';
      }
      jeSetAndSelect(v);
    }
  },
  {
    id: 'je_removeProperty',
    name: _=>`remove property ${jeContext && jeContext[jeContext.length-1]}`,
    context: ' ↦ (?=[^"]+$)',
    call: async function() {
      let pointer = jeGetValue(jeContext.slice(0, -1));
      if(Array.isArray(pointer))
        pointer.splice(jeContext[jeContext.length-1], 1);
      else
        delete pointer[jeContext[jeContext.length-1]];

      const oldStart = getSelection().anchorOffset;
      const oldEnd   = getSelection().focusOffset;
      jeSet(JSON.stringify(jeStateNow, null, '  '));
      jeSelect(oldStart, oldEnd, true);
    },
    show: function() {
      return jeGetValue(jeContext.slice(0, -1))[jeContext[jeContext.length-1]] !== undefined;
    }
  },
  {
    id: 'je_openDeck',
    name: 'Open deck',
    icon: '[deck]',
    forceKey: 'ArrowDown',
    context: '^card',
    show: _=>widgets.has(jeStateNow.deck),
    call: async function() {
      jeSelectWidget(widgets.get(jeStateNow.deck));
    }
  },
  {
    id: 'je_addMultiProperty',
    name: 'add property',
    context: '^Multi-Selection',
    options: [ { type: 'string', label: 'Property' } ],
    call: async function(options) {
      jeStateNow[options.Property] = null;
      jeUpdateMulti();
    }
  },
  {
    id: 'je_multiShift',
    name: 'shift',
    context: '^Multi-Selection ↦ [^ ]+',
    show: _=>jeGetValue()&&typeof jeGetValue()[jeGetLastKey()] == 'number',
    options: [ { type: 'number', label: 'Offset', value: 0 } ],
    call: async function(options) {
      const property = jeContext[1];
      for(const widget of jeMultiSelectedWidgets()) {
        const target = options.Offset + (typeof jeStateNow[property] == 'number' ? jeStateNow[property] : jeStateNow[property][widget.get('id')]);
        if(widget.get(property) !== target)
          await widget.set(property, target);
      }
      jeUpdateMulti();
    }
  }
];

function jeRoutineCall(callback, synchronous) {
  const f = function() {
    let routineIndex = -1;
    for(let i=jeContext.length-1; i>=0; --i) {
      if(String(jeContext[i]).match(/Routine$/)) {
        routineIndex = i;
        break;
      }
    }

    const routine = jeGetValue(jeContext.slice(1, routineIndex+1));
    if(jeContext.length >= routineIndex)
      return callback(routineIndex, routine, jeContext[routineIndex+1], routine[jeContext[routineIndex+1]]);
    else
      return callback(routineIndex, routine, null, null);
  };

  if(synchronous)
    return f;
  else
    return async _=>f();
}

let jeExpressionCounter = 0;
function jeAddRoutineExpressionCommands(variable, expression) {
  jeCommands.push({
    id: 'expression_' + ++jeExpressionCounter,
    name: `Expression: ${variable}`,
    class: 'expression',
    context: `^.*Routine`,
    call: jeRoutineCall(function(routineIndex, routine, operationIndex, operation) {
      if(operationIndex === null)
        routine.push(`var ###SELECT ME### = ${expression}`);
      else
        routine.splice(operationIndex+1, 0, `var ###SELECT ME### = ${expression}`);
      jeSetAndSelect(variable, true);
    }),
    show: jeRoutineCall((_, routine)=>Array.isArray(routine), true)
  });
}

function jeAddRoutineOperationCommands(command, defaults) {
  jeCommands.push({
    id: 'operation_' + command,
    name: command,
    class: 'operation',
    context: `^.*Routine`,
    call: jeRoutineCall(function(routineIndex, routine, operationIndex, operation) {
      if(operationIndex === null)
        routine.push({func: '###SELECT ME###'});
      else
        routine.splice(operationIndex+1, 0, {func: '###SELECT ME###'});
      jeSetAndSelect(command);
    }),
    show: jeRoutineCall((_, routine)=>Array.isArray(routine), true)
  });

  for(const property in defaults) {
    jeCommands.push({
      id: 'default_' + command + '_' + property,
      name: property,
      context: `^.* ↦ \\(${command}\\) ↦ `,
      call: property == 'sortBy' ? // Special case for sortBy; emulate jeInsert w/special replacement
        jeRoutineCall(function(routineIndex, routine, operationIndex, operation) {
          jeGetValue(jeContext.slice(1,routineIndex+2)).sortBy = {
            "key": "###SELECT ME###",
            "reverse": false
          };
          jeSetAndSelect('z');
        }) :
        jeRoutineCall(function(routineIndex, routine, operationIndex, operation) {
          jeInsert(jeContext.slice(1, routineIndex+2), property, defaults[property]);
        }),
      show: jeRoutineCall(function(routineIndex, routine, operationIndex, operation) {
        return operation && operation[property] === undefined;
      }, true)
    });
  }
}

function jeAddCommands() {
  const widgetTypes = [ 'all' ];
  const collectionNames = [ 'all', 'DEFAULT', 'thisButton', 'child', 'widget' ];

  widgetTypes.push(jeAddWidgetPropertyCommands(new BasicWidget()));
  widgetTypes.push(jeAddWidgetPropertyCommands(new Button()));
  widgetTypes.push(jeAddWidgetPropertyCommands(new Canvas()));
  widgetTypes.push(jeAddWidgetPropertyCommands(new Card()));
  widgetTypes.push(jeAddWidgetPropertyCommands(new Deck()));
  widgetTypes.push(jeAddWidgetPropertyCommands(new Holder()));
  widgetTypes.push(jeAddWidgetPropertyCommands(new Label()));
  widgetTypes.push(jeAddWidgetPropertyCommands(new Pile()));
  widgetTypes.push(jeAddWidgetPropertyCommands(new Seat()));
  widgetTypes.push(jeAddWidgetPropertyCommands(new Spinner()));
  widgetTypes.push(jeAddWidgetPropertyCommands(new Timer()));

  jeAddRoutineOperationCommands('AUDIO', { source: '', type: 'audio/mpeg', maxVolume: 1.0, length: null, player: null });
  jeAddRoutineOperationCommands('CALL', { widget: 'id', routine: 'clickRoutine', return: true, arguments: {}, variable: 'result' });
  jeAddRoutineOperationCommands('CANVAS', { canvas: null, mode: 'reset', x: 0, y: 0, value: 1 ,color:'#1F5CA6' });
  jeAddRoutineOperationCommands('CLICK', { collection: 'DEFAULT', count: 1 , mode:'respect'});
  jeAddRoutineOperationCommands('COUNT', { collection: 'DEFAULT', holder: null, variable: 'COUNT' });
  jeAddRoutineOperationCommands('CLONE', { source: 'DEFAULT', collection: 'DEFAULT', xOffset: 0, yOffset: 0, count: 1, properties: null });
  jeAddRoutineOperationCommands('DELETE', { collection: 'DEFAULT'});
  jeAddRoutineOperationCommands('FLIP', { count: 0, face: null, faceCycle: 'forward', holder: null, collection: 'DEFAULT' });
  jeAddRoutineOperationCommands('FOREACH', { loopRoutine: [], in: [], collection: 'DEFAULT' });
  jeAddRoutineOperationCommands('GET', { variable: 'id', collection: 'DEFAULT', property: 'id', aggregation: 'first', skipMissing: false });
  jeAddRoutineOperationCommands('IF', { condition: null, operand1: null, relation: '==', operand2: null, thenRoutine: [], elseRoutine: [] });
  jeAddRoutineOperationCommands('INPUT', { cancelButtonIcon: null, cancelButtonText: "Cancel", confirmButtonIcon: null, confirmButtonText: "OK", fields: [] } );
  jeAddRoutineOperationCommands('LABEL', { value: 0, mode: 'set', label: null, collection: 'DEFAULT' });
  jeAddRoutineOperationCommands('MOVE', { count: 1, face: null, from: null, to: null });
  jeAddRoutineOperationCommands('MOVEXY', { count: 1, face: null, from: null, x: 0, y: 0, snapToGrid: true });
  jeAddRoutineOperationCommands('RECALL', { owned: true, holder: null });
  jeAddRoutineOperationCommands('ROTATE', { count: 1, angle: 90, mode: 'add', holder: null, collection: 'DEFAULT' });
  jeAddRoutineOperationCommands('SELECT', { type: 'all', property: 'parent', relation: '==', value: null, max: 999999, collection: 'DEFAULT', mode: 'set', source: 'all', sortBy: '###SEE jeAddRoutineOperation###'});
  jeAddRoutineOperationCommands('SET', { collection: 'DEFAULT', property: 'parent', relation: '=', value: null });
  jeAddRoutineOperationCommands('SHUFFLE', { holder: null, collection: 'DEFAULT' });
  jeAddRoutineOperationCommands('SORT', { key: 'value', reverse: false, rearrange: false, locales: null, options: null, holder: null, collection: 'DEFAULT' });
  jeAddRoutineOperationCommands('TIMER', { value: 0, seconds: 0, mode: 'toggle', timer: null, collection: 'DEFAULT' });
  jeAddRoutineOperationCommands('TURN', { turn: 1, turnCycle: 'forward', source: 'all', collection: 'TURN' });

  jeAddRoutineExpressionCommands('random', 'randInt 1 10');
  jeAddRoutineExpressionCommands('increment', '${variableName} + 1');

  jeAddCSScommands();

  jeAddFaceCommand('border', '', 1);
  jeAddFaceCommand('classes', '', '');
  jeAddFaceCommand('css', '', {});
  jeAddFaceCommand('properties', '', {});
  jeAddFaceCommand('radius', ' (rounded corners)', 1);

  jeAddGridCommand('x', 0);
  jeAddGridCommand('y', 0);
  jeAddGridCommand('minX', 0);
  jeAddGridCommand('minY', 0);
  jeAddGridCommand('offsetX', 0);
  jeAddGridCommand('offsetY', 0);
  jeAddGridCommand('rotation', 0);

  jeAddFieldCommand('text', 'subtitle|title|text', '');
  jeAddFieldCommand('label', 'checkbox|color|number|select|string|switch', '');
  jeAddFieldCommand('value', 'checkbox|color|number|select|string|switch', '');
  jeAddFieldCommand('variable', 'checkbox|color|number|select|string|switch', '');
  jeAddFieldCommand('min', 'number', 0);
  jeAddFieldCommand('max', 'number', 10);
  jeAddFieldCommand('options', 'select', [ { value: 'value', text: 'text' } ]);

  jeAddEnumCommands('^[a-z]+ ↦ type', widgetTypes.slice(1));
  jeAddEnumCommands('^.*\\([A-Z]+\\) ↦ value', [ '${}' ]);
  jeAddEnumCommands('^deck ↦ faceTemplates ↦ [0-9]+ ↦ objects ↦ [0-9]+ ↦ textAlign', [ 'left', 'center', 'right' ]);
  jeAddEnumCommands('^.*\\(AUDIO\\) ↦ type', [ 'audio/midi', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-wav' ]);
  jeAddEnumCommands('^.*\\(AUDIO\\) ↦ player', [ '${}', '${playerName}' ]);
  jeAddEnumCommands('^.*\\(CANVAS\\) ↦ mode', [ 'set', 'inc', 'dec', 'change', 'reset', 'setPixel' ]);
  jeAddEnumCommands('^.*\\(CLICK\\) ↦ mode', [ 'respect', 'ignoreClickable', 'ignoreClickRoutine', 'ignoreAll' ]);
  jeAddEnumCommands('^.*\\(FLIP\\) ↦ faceCycle', [ 'forward', 'backward', 'random' ]);
  jeAddEnumCommands('^.*\\(GET\\) ↦ aggregation', [ 'first', 'last', 'array', 'average', 'median', 'min', 'max', 'sum' ]);
  jeAddEnumCommands('^.*\\(IF\\) ↦ relation', [ '<', '<=', '==', '!=', '>', '>=' ]);
  jeAddEnumCommands('^.*\\(IF\\) ↦ (operand1|operand2|condition)', [ '${}' ]);
  jeAddEnumCommands('^.*\\(INPUT\\) ↦ fields ↦ [0-9]+ ↦ type', [ 'checkbox', 'color', 'number', 'select', 'string', 'subtitle', 'switch', 'text', 'title' ]);
  jeAddEnumCommands('^.*\\(LABEL\\) ↦ mode', [ 'set', 'dec', 'inc', 'append' ]);
  jeAddEnumCommands('^.*\\(ROTATE\\) ↦ angle', [ 45, 60, 90, 135, 180 ]);
  jeAddEnumCommands('^.*\\(ROTATE\\) ↦ mode', [ 'set', 'add' ]);
  jeAddEnumCommands('^.*\\(SELECT\\) ↦ mode', [ 'set', 'add', 'remove', 'intersect' ]);
  jeAddEnumCommands('^.*\\(SELECT\\) ↦ relation', [ '<', '<=', '==', '!=', '>', '>=', 'in' ]);
  jeAddEnumCommands('^.*\\(SELECT\\) ↦ type', widgetTypes);
  jeAddEnumCommands('^.*\\(SET\\) ↦ relation', [ '+', '-', '=', "*", "/",'!' ]);
  jeAddEnumCommands('^.*\\(TIMER\\) ↦ mode', [ 'pause', 'start', 'toggle', 'set', 'dec', 'inc', 'reset']);
  jeAddEnumCommands('^.*\\(TIMER\\) ↦ value', [ 0, 'start', 'end', 'milliseconds']);
  jeAddEnumCommands('^.*\\(TURN\\) ↦ turnCycle', [ 'forward', 'backward', 'random', 'position']);
  jeAddEnumCommands('^.*\\([A-Z]+\\) ↦ property', [ 'id', 'parent', 'type', 'rotation' ]);

  jeAddEnumCommands('^.*\\((CLICK|COUNT|DELETE|FLIP|GET|LABEL|ROTATE|SET|SORT|SHUFFLE|TIMER)\\) ↦ collection', collectionNames.slice(1));
  jeAddEnumCommands('^.*\\(CLONE\\) ↦ source', collectionNames.slice(1));
  jeAddEnumCommands('^.*\\((SELECT|TURN)\\) ↦ source', collectionNames);

  jeAddNumberCommand('increment number', '+', x=>x+1);
  jeAddNumberCommand('decrement number', '-', x=>x-1);
  jeAddNumberCommand('double number', '*', x=>x*2);
  jeAddNumberCommand('half number', '/', x=>x/2);
  jeAddNumberCommand('zero', '0', x=>0);
  jeAddNumberCommand('opposite value', '0', x=>-x);
  jeAddNumberCommand('${}', '0', x=>'${}');

  jeAddAlignmentCommands();
}

function jeAddAlignmentCommands() {
  jeCommands.push({
    id: 'jeCenterInParent',
    name: 'center in parent',
    context: '^.* ↦ (x|y)( ↦ "[0-9]+")?' + String.fromCharCode(36), // the minifier doesn't like "$" or "\x24" here
    show: _=>!jeContext.includes('grid'),
    call: async function() {
      const key = jeGetLastKey();
      const sizeKey = key == 'x' ? 'width' : 'height';
      const parentSize = jeStateNow.parent ? widgets.get(jeStateNow.parent).get(sizeKey) : (sizeKey == 'width' ? 1600 : 1000);
      jeStateNow[key] = '###SELECT ME###';
      jeSetAndSelect((parentSize-widgets.get(jeStateNow.id).get(sizeKey))/2);
    }
  });
  jeCommands.push({
    id: 'jeMultiAlign',
    name: 'align',
    context: '^Multi-Selection ↦ (x|y)',
    options: [
      { label: 'Coordinate', type: 'select', options: [ { value: 0.5, text: 'Center' }, { value: 0, text: 'Top/Left' }, { value: 1, text: 'Bottom/Right'  } ] },
      { label: 'Reference',  type: 'select', options: [ { value: 'First selected widget' }, { value: 'Lowest value' }, { value: 'Highest value' }, { value: 'Center of all' } ] }
    ],
    call: async function(options) {
      const key = jeContext[1];
      const sizeKey = key == 'x' ? 'width' : 'height';
      const selected = jeMultiSelectedWidgets();
      const coords = selected.map(w=>w.absoluteCoord(key) + w.get(sizeKey)*options.Coordinate);

      let target = coords[0];
      if(options.Reference == 'Lowest value')
        target = Math.min(...coords);
      if(options.Reference == 'Highest value')
        target = Math.max(...coords);
      if(options.Reference == 'Center of all')
        target = (Math.max(...coords) + Math.min(...coords)) / 2;
      for(const w of selected)
        await w.set(key, target - w.get(sizeKey)*options.Coordinate - (w.get('parent') ? widgets.get(w.get('parent')).absoluteCoord(key) : 0));
      jeUpdateMulti();
    }
  });
  jeCommands.push({
    id: 'jeMultiDistribute',
    name: 'distribute',
    context: '^Multi-Selection ↦ (x|y)',
    call: async function() {
      const key = jeContext[1];
      const sizeKey = key == 'x' ? 'width' : 'height';
      const selected = jeMultiSelectedWidgets();

      const min = Math.min(...selected.map(w=>w.absoluteCoord(key)));
      const max = Math.max(...selected.map(w=>w.absoluteCoord(key)+w.get(sizeKey)));
      const heights = selected.map(w=>w.get(sizeKey)).reduce((a,b)=>a + b);
      const spacing = (max-min-heights)/(selected.length-1);
      selected.sort((a,b)=>a.absoluteCoord(key) - b.absoluteCoord(key));
      for(const widget of selected) {
        const before = selected.slice(0, selected.findIndex(w=>w.id == widget.id));
        await widget.set(key, Math.round(min + before.map(w=>w.get(sizeKey) + spacing).reduce((a,b)=>a + b, 0) - (widget.get('parent') ? widgets.get(widget.get('parent')).absoluteCoord(key) : 0)));
      }
      jeUpdateMulti();
    }
  });
}

function displayComputeOps() {
  const keyword = $('#var_search').value;
  let results = compute_ops.filter(o => o.name.toLowerCase().includes(keyword.toLowerCase()) || o.desc.toLowerCase().includes(keyword.toLowerCase()));
  var resultTable = '<table>';
  if(keyword.length > 0) {
    for(const r of Object.values(results).sort((a, b) => a.name.toString().localeCompare(b.name)))
      resultTable += '<tr valign=top><td><b>' + r.name + '</b></td><td><b>' + r.sample + '</b><br>' + r.desc + '</td></tr>';
  }
  resultTable += '</table>';
  $('#var_results').innerHTML = resultTable;
  jeKeyword = keyword;
}

function jeAddCSScommands() {
  const string_presets = {
    "border": "1px solid black", "background": "white", "font-size": "16px", "color": "black", "background-image": "url('')"
  };
  const nested_presets = {
    '[a-z]+': {
      'default': string_presets,
      ':hover': string_presets
    },
    'seat': {
      '.seated.turn': {}
    },
    'timer': {
      '.alert': {}, '.paused':{}
    },
    'holder': {
      '.droppable': {"border": "calc(1px / var(--scale)) solid #aaa !important"},
      '.droptarget': {"border": "calc(1px / var(--scale)) solid #333 !important"}
    },
    'pile': {
      '.pile .handle': {}
    }
  };

  // Add nested object button items
  for(const type in nested_presets) {
    for(const cssSection in nested_presets[type]) { // Add CSS sections
      jeCommands.push({
        id: 'css_' + cssSection,
        name: cssSection,
        context: `^${type} ↦ css`,
        show:  function() {
          if(typeof jeStateNow.css != "object" || jeStateNow.css === null || JSON.stringify(jeStateNow.css) == '{}')
            return false;
          for(const property in jeStateNow.css)
            if(typeof jeStateNow.css[property] != "object")
              return false;
          return jeStateNow.css[cssSection] == undefined;
        },
        call: async function() {
          jeStateNow.css[cssSection] = '###SELECT ME###';
          jeSetAndSelect({});
        }
      });
      for(const cssProperty in nested_presets[type][cssSection]) { // Add entries per-section
        jeCommands.push({
          id: 'css_' + cssSection + '_' + cssProperty,
          name: cssProperty,
          context: `^${type} ↦ css ↦ [^↦]*`,
          show: function() {
            const contents = jeStateNow.css[cssSection];
            return typeof contents == "object" && contents !== null && jeContext.includes(cssSection) && !(cssProperty in contents);
          },
          call: async function() {
            jeStateNow.css[cssSection][cssProperty] = '###SELECT ME###';
            jeSetAndSelect(nested_presets[type][cssSection][cssProperty]);
          }
        });
      }
    }
  }

  // Add simple object button items
  for(const cssProperty in string_presets) { // Add entries in "default" (only) section
    jeCommands.push({
      id: 'css_string_' + cssProperty,
      name: cssProperty,
      context: `.* ↦ (css|[a-z]+CSS)`,
      show: function() { // Need to make sure it is a simple object (contents are "key": "string" pairs)
        const cssKind = jeContext.join(' ↦ ').match(this.context)[1];
        const contents = jeStateNow[cssKind];
        if(typeof contents != "object" || contents === null || cssProperty in contents) // simple object, property already there
          return false;
        for(const property in jeStateNow[cssKind]) // Check to see if any sub-objects
          if(typeof jeStateNow[cssKind][property] == "object")
            return false;
        return true; // All OK
      },
      call: async function() {
        const cssKind = jeContext.join(' ↦ ').match(this.context)[1];
        jeStateNow[cssKind][cssProperty] = '###SELECT ME###';
        jeSetAndSelect(string_presets[cssProperty]);
      }
    });
  }
}

function jeAddEnumCommands(context, values) {
  for(const v of values) {
    jeCommands.push({
      id: 'enum_' + String(v),
      name: String(v),
      context: context,
      call: async function() {
        jeInsert(null, jeGetLastKey(), v);
      },
      show: function() {
        let pointer = jeGetValue();
        return pointer[jeGetValue()] !== v;
      }
    });
  }
}

function jeAddFaceCommand(key, description, value) {
  jeCommands.push({
    id: 'face_' + key+description,
    name: key+description,
    context: '^deck ↦ faceTemplates ↦ [0-9]+',
    show: _=>!jeStateNow.faceTemplates[+jeContext[2]][key],
    call: async function() {
      jeStateNow.faceTemplates[+jeContext[2]][key] = '###SELECT ME###';
      jeSetAndSelect(value);
    }
  });
}

function jeAddFieldCommand(key, types, value) {
  jeCommands.push({
    id: 'field_' + key,
    name: key,
    context: '^.*\\(INPUT\\) ↦ fields ↦ [0-9]+',
    show: jeRoutineCall(function(routineIndex) {
      const field = jeGetValue(jeContext.slice(1, routineIndex+5));
      return typeof field[key] === 'undefined' && (field.type || '').match(types);
    }, true),
    call: jeRoutineCall(function(routineIndex, routine, operationIndex, operation) {
      jeGetValue(jeContext.slice(1, routineIndex+5))[key] = key != 'options' ? '###SELECT ME###' :
        [
          {
            value: "###SELECT ME###",
            text: "text"
          }
        ];
      jeSetAndSelect( key != 'options' ? value : "value");
    })
  });
}

function jeAddGridCommand(key, value) {
  jeCommands.push({
    id: 'grid_' + key,
    name: key,
    context: '^[^ ]* ↦ grid ↦ [0-9]+',
    show: _=>!(key in jeStateNow.grid[+jeContext[2]]),
    call: async function() {
      jeStateNow.grid[+jeContext[2]][key] = '###SELECT ME###';
      jeSetAndSelect(value);
    }
  });
}

function jeAddNumberCommand(name, key, callback) {
  jeCommands.push({
    id: 'number_' + name,
    name: name,
    forceKey: key,
    context: '.*',
    show: _=>jeGetValue()&&typeof jeGetValue()[jeGetLastKey()] == 'number',
    call: async function() {
      const newValue = callback(jeGetValue()[jeGetLastKey()]);
      jeGetValue()[jeGetLastKey()] = '###SELECT ME###';
      jeSetAndSelect(newValue);
    }
  });
}

function jeAddWidgetPropertyCommands(object) {
  for(const property in object.defaults)
    if(property != 'typeClasses' && !property.match(/^c[0-9]{2}$/))
      jeAddWidgetPropertyCommand(object, property);
  const type = object.defaults.typeClasses.replace(/widget /, '');
  return type == 'basic' ? null : type;
}

const buttonColorProperties = ['backgroundColor', 'borderColor', 'textColor', 'backgroundColorOH', 'borderColorOH', 'textColorOH'];

function jeAddWidgetPropertyCommand(object, property) {
  jeCommands.push({
    id: 'widget_' + object.getDefaultValue('typeClasses').replace('widget ', '') + '_' + property,
    name: property,
    class: 'property',
    context: `^${object.getDefaultValue('typeClasses').replace('widget ', '')}`,
    call: property=='dropTarget'? // Special case for dropTarget, faces, and spinner options
            async function() {
              jeStateNow.dropTarget = {
                "type": "###SELECT ME###"
              };
              jeSetAndSelect('card');
            }
        : property=='faces' ?
            async function() {
              jeStateNow.faces = ["###SELECT ME###"];
              jeSetAndSelect({});
            }
        : object.getDefaultValue('typeClasses').replace('widget ', '') + '_' + property == 'spinner_options' ?
            async function() {
              jeStateNow.options = "###SELECT ME###";
              jeSetAndSelect([]);
            }
        : property == 'inheritFrom' || property == 'css' ? // Special case to override defaults for these two
            async function() {
              jeStateNow[property] = '###SELECT ME###';
              jeSetAndSelect({});
            }
        : async function() {
             jeInsert([], property, property.match(/Routine$/) ? [] : object.getDefaultValue(property));
           },
    show: function() {
      return jeStateNow[property] === undefined && !(object.getDefaultValue('typeClasses').replace('widget ', '') == 'button' && buttonColorProperties.includes(property));
    }
  });
}

// Called from overlayDone in editmode.js to finish up add widget processing in the JSON editor.
function jeAddWidgetDone(id) {
  jeSelectWidget(widgets.get(id));
  jeStateNow.id = '###SELECT ME###';
  jeSetAndSelect(id);
  jeGetContext();
}

async function jeApplyChanges() {
  if(jeMode == 'multi')
    return await jeApplyChangesMulti();

  const currentStateRaw = jeGetEditorContent();
  const completeState = JSON.parse(jePostProcessText(currentStateRaw).replace(/,(?=\n *[\]}],?$)/gm, ''));

  // apply external changes that happened while the key was pressed
  for(const delta of jeKeyIsDownDeltas)
    for(const key in delta)
      completeState[key] = delta[key];

  const currentState = JSON.stringify(jePostProcessObject(completeState));
  if(currentStateRaw != jeStateBeforeRaw || jeKeyIsDownDeltas.length) {
    jeDeltaIsOurs = true;
    await jeApplyExternalChanges(completeState);
    jeStateBeforeRaw = currentStateRaw;
    const oldState = jeStateBefore;
    jeStateBefore = currentState;
    await updateWidget(currentState, oldState); // in editmode.js
    jeDeltaIsOurs = false;
  }
}

async function jeApplyChangesMulti() {
  const setValueIfNeeded = async function(widget, key, value) {
    if(widget.get(key) !== value)
      await widget.set(key, value);
  };

  const currentState = JSON.parse(jeGetEditorContent());

  if(jeGetContext()[1] == 'widgets') {
    var cursorState = jeCursorStateGet();
    jeUpdateMulti();
    jeCursorStateSet(cursorState);
  } else {
    jeDeltaIsOurs = true;
    for(const key in currentState) {
      if(key != 'widgets') {
        for(const w of jeMultiSelectedWidgets()) {
          if(typeof currentState[key] != 'object' || currentState[key] === null)
            await setValueIfNeeded(w, key, currentState[key]);
          else if(currentState[key][w.get('id')] !== undefined)
            await setValueIfNeeded(w, key, currentState[key][w.get('id')]);
        }
      }
    }
    jeDeltaIsOurs = false;
  }
}

function jeApplyDelta(delta) {
  if(jeMode == 'widget') {
    for(const field of [ 'id', 'deck' ]) {
      if(!jeDeltaIsOurs && jeStateNow && jeStateNow[field] && delta.s[jeStateNow[field]] !== undefined) {
        if(delta.s[jeStateNow[field]] === null) {
          jeEmpty();
        } else {
          if(jeKeyIsDown) {
            jeKeyIsDownDeltas.push(delta.s[jeStateNow[field]]);
            return;
          }

          jeSelectWidget(widgets.get(jeStateNow.id), document.activeElement !== $('#jeText'), false, true);
        }
      }
    }
  }

  if(jeMode == 'multi' && !jeDeltaIsOurs) {
    try {
      for(const selectedWidget of JSON.parse(jeGetEditorContent()).widgets) {
        if(delta.s[selectedWidget] !== undefined) {
          if(jeKeyIsDown) {
            jeKeyIsDownDeltas.push(delta.s);
            return;
          }

          return jeUpdateMulti();
        }
      }
    } catch(e) {
    }
  }

  jeUpdateTree(delta.s);
  widgetCoordCache = null;
}

function jeApplyState(state) {
  jeEmpty();
  jeDisplayTree();
}

async function jeApplyExternalChanges(state) {
  const before = JSON.parse(jeStateBefore);
  if(state.type == 'card' && state.deck === before.deck) {
    const cardDefaults = { ...widgets.get(state.deck).get('cardDefaults') };
    if(state['cardDefaults (in deck)'] && JSON.stringify(state['cardDefaults (in deck)']) != JSON.stringify(cardDefaults))
      await widgets.get(state.deck).set('cardDefaults', state['cardDefaults (in deck)']);

    if(state.cardType === before.cardType) {
      const cardTypes = { ...widgets.get(state.deck).get('cardTypes') };
      if(state['cardType ['+ state.cardType + '] (in deck)'] && JSON.stringify(state['cardType ['+ state.cardType + '] (in deck)']) != JSON.stringify(cardTypes[state.cardType])) {
        cardTypes[state.cardType] = state['cardType ['+ state.cardType + '] (in deck)'];
        await widgets.get(state.deck).set('cardTypes', cardTypes);
      }
    }
  }
}

async function jeCallCommand(command) {
  if(command.options) {
    jeCommandWithOptions = command;
  } else {
    jeDeltaIsOurs = true;
    await command.call();
    jeDeltaIsOurs = false;
  }
}

function jeCommandOptions() {
  const div = document.createElement('div');
  div.id = 'jeCommandOptions';
  div.innerHTML = '<b>Command options:</b><div></div><button>Go</button><button>Cancel</button>';
  $('#jeCommands').insertBefore(div, $('#jeTopButtons').nextSibling);

  for(const option of jeCommandWithOptions.options) {
    formField(option, $('#jeCommandOptions div'), `${jeCommandWithOptions.id}_${option.label}`);
    $('#jeCommandOptions div').append(document.createElement('br'));
  }

  $a('#jeCommandOptions button')[0].addEventListener('click', async function() {
    const options = {};
    for(const option of jeCommandWithOptions.options) {
      const input = $(`[id="${jeCommandWithOptions.id}_${option.label}"]`);
      options[option.label] = option.type == 'checkbox' ? input.checked : input.value;
      if(option.type == 'number')
        options[option.label] = parseFloat(options[option.label]);
      if(Number.isNaN(options[option.label]))
        options[option.label] = 0;
    }

    await jeCommandWithOptions.call(options);
    jeCommandWithOptions = null;
    jeShowCommands();
  });

  $a('#jeCommandOptions button')[1].addEventListener('click', function() {
    jeCommandWithOptions = null;
    jeShowCommands();
  });
}

async function jeClick(widget, e) {
  if(e.ctrlKey) {
    jeSelectWidget(widget, false, e.shiftKey || e.which == 3 || e.button == 2);
  } else {
    await widget.click();
  }
}

function jeCursorStateGet() {
  const aO = getSelection().anchorOffset;
  const fO = getSelection().focusOffset;
  const s = Math.min(aO, fO);
  const e = Math.max(aO, fO);
  const v = jeGetEditorContent();
  const linesUntilCursor = v.split('\n').slice(0, v.substr(0, s).split('\n').length);
  const currentLine = linesUntilCursor.pop();
  let defaultValueToAdd = null;
  try {
    const defaultValueMatch = currentLine.match(/^  "([^"]+)": (.*?),?$/);
    if(defaultValueMatch && jeWidget && jeWidget.getDefaultValue(defaultValueMatch[1]) === JSON.parse(defaultValueMatch[2]))
      defaultValueToAdd = defaultValueMatch[1];
  } catch(e) {}
  return {
    currentLine,
    defaultValueToAdd,
    sameLinesBefore: linesUntilCursor.filter(l=>l==currentLine).length,
    start: s-linesUntilCursor.join('\n').length,
    end: e-linesUntilCursor.join('\n').length
  };
}

function jeCursorStateSet(state) {
  const v = jeGetEditorContent();
  const lines = v.split('\n');
  let offset = 0;
  let linesFound = 0;
  for(const line of lines) {
    if(line == state.currentLine && linesFound++ == state.sameLinesBefore) {
      jeSelect(offset + state.start - 1, offset + state.end - 1);
      break;
    } else {
      offset += line.length + 1;
    }
  }
}

function jeSelectWidget(widget, dontFocus, addToSelection, restoreCursorPosition) {
  if(restoreCursorPosition)
    var cursorState = jeCursorStateGet();

  if(addToSelection && (jeMode == 'widget' || jeMode == 'multi')) {
    jeSelectWidgetMulti(widget, dontFocus);
  } else {
    jeMode = 'widget';
    jeWidget = widget;
    jePlainWidget = new widget.constructor();
    jeKeyIsDownDeltas = [];
    jeStateNow = JSON.parse(JSON.stringify(widget.state));
    if(restoreCursorPosition && cursorState.defaultValueToAdd && jeStateNow[cursorState.defaultValueToAdd] === undefined)
      jeStateNow[cursorState.defaultValueToAdd] = jeWidget.getDefaultValue(cursorState.defaultValueToAdd);
    jeSet(jeStateBefore = jePreProcessText(JSON.stringify(jePreProcessObject(jeStateNow), null, '  ')), dontFocus);
    editPanel.style.setProperty('--treeHeight', "20%");
  }

  jeCenterSelection();

  if(restoreCursorPosition)
    jeCursorStateSet(cursorState);

  jeGetContext();
}

function jeSelectWidgetMulti(widget, dontFocus) {
  const wID = widget.get('id');

  if(jeMode == 'widget')
    jeStateNow = { widgets: [ jeWidget.get('id'), wID ] };
  else if(jeStateNow.widgets.indexOf(wID) != -1)
    jeStateNow.widgets.splice(jeStateNow.widgets.indexOf(wID), 1);
  else
    jeStateNow.widgets.push(wID);

  if(jeStateNow.widgets.length == 1 || jeStateNow.widgets[0] == jeStateNow.widgets[1])
    return jeSelectWidget(widgets.get(jeStateNow.widgets[0]), dontFocus);

  jeWidget = null;
  jeMode = 'multi';
  jeUpdateMulti(dontFocus);
}

function jeMultiSelectedWidgets() {
  let selected = [];
  for(const search of jeStateNow.widgets) {
    selected = selected.concat(widgetFilter(function(w) {
      const isRegex = search.match(/^\/(.*)\/([a-z]+)?$/);
      try {
        if(isRegex && w.get('id').match(new RegExp(isRegex[1], isRegex[2])))
          return true;
      } catch(e) {}
      if(!isRegex && w.get('id') == search)
        return true;
    }));
  }
  return selected;
}

function jeSelectedIDs() {
  if(!jeStateNow)
    return [];
  else if(jeMode == 'multi')
    return jeMultiSelectedWidgets().map(w=>w.get('id'));
  else
    return [ jeStateNow.id ];
}

function jeCenterSelection() {
  const selectedIDs = jeSelectedIDs();

  for(const widgetDOM of $a('#jeTree .key')) {
    widgetDOM.parentElement.classList.toggle('jeHighlightRow', selectedIDs.indexOf(widgetDOM.textContent) != -1);
    if(selectedIDs.indexOf(widgetDOM.textContent) != -1)
      widgetDOM.scrollIntoView({ block: 'center' });
  }

  jeHighlightWidgets();
}

function jeHighlightWidgets() {
  const selectedIDs = jeSelectedIDs();
  for(const [ id, w ] of widgets)
    w.setHighlighted(jeWidgetHighlighting && selectedIDs.indexOf(id) != -1);
}

function jeUpdateMulti(dontFocus) {
  jeCenterSelection();
  const keys = [ 'x', 'y', 'width', 'height', 'parent', 'z', 'layer' ];
  for(const usedKey in jeStateNow || [])
    if(usedKey != 'widgets' && keys.indexOf(usedKey) == -1)
      keys.push(usedKey);
  for(const key of keys) {
    jeStateNow[key] = {};
    for(const selectedWidget of jeMultiSelectedWidgets())
      jeStateNow[key][selectedWidget.get('id')] = selectedWidget.get(key);
    if(Object.values(jeStateNow[key]).every( (val, i, arr) => val === arr[0] ))
      jeStateNow[key] = Object.values(jeStateNow[key])[0];
  }
  jeSet(jeStateBefore = JSON.stringify(jeStateNow, null, '  '), dontFocus);
}

function html(string) {
  return string.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function jeColorize() {
  const langObj = [
    [ /^( +")(.*)( \(in .*)(":.*)$/, null, 'extern', 'extern', null ], // e.g. "cardDefaults (in deck)": ...
    [ /^( +")(.*)(": ")(.*)(",?)$/, null, 'key', null, 'string', null ], // e.g. "value": "..."
    [ /^( +")(.*)(": )(-?[0-9.]+)(,?)$/, null, 'key', null, 'number', null ], // e.g. "value": 3
    [ /^( +)(-?[0-9.]+)(,?)$/, null, 'number', null ], // e.g. -37 (for example an array element)
    [ /^( +")(.*)(": )(null|true|false)(,?)$/, null, 'key', null, 'null', null ], // e.g. "value": true
    [ /^( +")(.*)(":.*)$/, null, 'key', null ], // e.g. "value": <some random string>
    [ /^(Room)$/, 'extern' ],
    [ /^( +"var )(.*)( = )(-?[0-9.]+)?(null|true|false)?(\$\{[^}]+\})?('(?:[a-zA-Z0-9,.() _-]|\\\\u[0-9a-fA-F]{4})*')?( )?([0-9a-zA-Z_-]+|[=+*/%<!>&|-]{1,3})?(🧮(?:[0-9a-zA-Z_-]+|[=+*/%<!>&|-]{1,2}))?( )?(-?[0-9.]+)?(null|true|false)?(\$\{[^}]+\})?('(?:[a-zA-Z0-9,.() _-]|\\\\u[0-9a-fA-F]{4})*')?( )?(-?[0-9.]+)?(null|true|false)?(\$\{[^}]+\})?('(?:[a-zA-Z0-9,.() _-]|\\\\u[0-9a-fA-F]{4})*')?( )?(-?[0-9.]+)?(null|true|false)?(\$\{[^}]+\})?('(?:[a-zA-Z0-9,.() _-]|\\\\u[0-9a-fA-F]{4})*')?(.*)(",?)$/, 'default', 'custom', null, 'number', 'null', 'variable', 'string', null, null, 'variable', null, 'number', 'null', 'variable', 'string', null, 'number', 'null', 'variable', 'string', null, 'number', 'null', 'variable', 'string', null, 'default' ],
    [ /^( +")(.*)(",?)$/, null, 'string', null ]
  ];
  let out = [];
  for(let line of jeGetEditorContent().split('\n')) {
    let foundMatch = false;
    for(const l of langObj) {
      const match = line.match(l[0]);
      if(match) {
        if(jeMode == 'widget' && match[1] == '  "' && l[2] == 'key' && (l[4] == "null" && match[4] == "null" || String(jeWidget.defaults[match[2]]) == match[4])) {
          out.push(`<i class=default>${html(line)}</i>`);
          foundMatch = true;
          break;
        }

        const c = {...l};
        if(jeMode == 'widget' && match[1] == '  "' && l[2] == 'key' && [ 'id', 'type' ].indexOf(match[2]) == -1 && jePlainWidget.getDefaultValue(match[2]) === undefined)
          c[2] = 'custom';

        for(let i=1; i<l.length; ++i) {
          if(l[i] && match[i]) {
            match[i] = `<i class=${c[i]}>${html(match[i])}</i>`;
            if(l[i]=='string' || l[i]=='key')
              match[i] = match[i].replace(/\$\{[^}]+\}/g, m=>`<i class=variable>${m}</i>`)
          } else if(match[i])
            match[i] = html(match[i]);
        }

        let newLine = match.slice(1).join('');

        out.push(newLine);
        foundMatch = true;

        break;
      }
    }
    if(!foundMatch)
      out.push(html(line));
  }
  $('#jeTextHighlight').innerHTML = out.join('\n');
}

/* Displaying and controlling tree subpane of edit area */

const editPanel = $('#jeEditArea');

let treeNodes = {};
let mouse_reference;
let resizer_reference;

function resize(e){
  const height = Math.min(editPanel.offsetHeight - 75, Math.max(0, resizer_reference - mouse_reference + e.y));
  editPanel.style.setProperty('--treeHeight', height + "px");
}

editPanel.addEventListener("mousedown", function(e){
  if(e.target == $('#jeResize')) {
    mouse_reference = e.y;
    resizer_reference = $('#jeTree').offsetHeight;
    document.addEventListener("mousemove", resize, false);
  }
});

document.addEventListener("mouseup", function(){
  document.removeEventListener("mousemove", resize, false);
});

function jeDisplayTree() {
  const allWidgets = Array.from(widgets.values());
  $('#jeTree').innerHTML = '<ul class=jeTreeDisplay>' + jeDisplayTreeAddWidgets(allWidgets, null, jeSelectedIDs()) + '</ul>';

  treeNodes = {};
  for(const dom of $a('#jeTree .key'))
    treeNodes[dom.innerText] = dom.parentNode;

  // Add handlers to tree elements to display widget contents
  on('.jeTreeExpander', 'click', function(e) {
    if(e.target.classList.contains('jeTreeExpander')) {
      $('.nested', e.target.parentElement).classList.toggle('active');
      e.target.classList.toggle('jeTreeExpander-down');
      e.stopImmediatePropagation();
    }
  });

  // Add handler to search box to display widget list
  on('#jeWidgetSearchBox', 'input', jeDisplayFilteredWidgets);
  on('#jeWidgetSearchBox', 'click', jeDisplayFilteredWidgets);

  on('.jeTreeWidget', 'click', function(e) {
    jeSelectWidget(widgets.get($('.key', e.currentTarget).innerText), false, e.shiftKey);
    e.stopPropagation();
  });
}

function jeDisplayTreeAddWidgets(allWidgets, parent, selectedIDs) {
  function colored(str, kind) {
    return `<i class=${kind}>${html(str)}</i>`
  }
  let result = '';

  for(const widget of (allWidgets.filter(w=>w.get('parent')==parent)).sort((w1,w2)=>w1.get('id').localeCompare(w2.get('id'), 'en', {numeric: true, ignorePunctuation: true}))) {
    const children = jeDisplayTreeAddWidgets(allWidgets, widget.get('id'), selectedIDs);
    const isSelected = selectedIDs.indexOf(widget.get('id')) != -1 ? 'jeHighlightRow' : '';

    if(children)
      result += `<li class="jeTreeWidget"><span class="jeTreeWidget ${isSelected} jeTreeExpander ${(widget.get('type')=='pile') ? '' : 'jeTreeExpander-down'}">`;
    else
      result += `<li class="jeTreeWidget ${isSelected}">`;

    result += jeTreeGetWidgetHTML(widget);

    if(children)
      result += `</span><ul class="jeNestedTree nested ${widget.get('type')=='pile' ? '' : 'active'}">${children}</ul>`;
    result += '</li>';

    delete allWidgets[allWidgets.indexOf(widget)];
  }
  return result;
}

function jeTreeGetWidgetHTML(widget) {
  function colored(str, kind) {
    return `<i class=${kind}>${html(str)}</i>`
  }
  const type = widget.get('type');

  let result = `${colored(widget.get('id'), 'key')} (${colored(type || 'basic','string')} - `;
  if(widget.get('id').match(/^[0-9a-z]{4}$/) && $('#jsonEditor').classList.contains('wide')) {
    if(type == 'card' && !widget.get('cardType').match(/^type-[0-9a-f-]{36}$/))
      result += `${colored(widget.get('cardType'),'extern')} - `;
    if(type == 'button' && widget.get('text'))
      result += `${colored(widget.get('text').replaceAll('\n', '\\n'),'extern')} - `;
    if(type == null && widget.get('classes'))
      result += `${colored(widget.get('classes'),'extern')} - `;
  }
  result += `${colored(String(Math.floor(widget.get('x'))),'number')},` +
    `${colored(String(Math.floor(widget.get('y'))),'number')})`;

  return result;
}

function jeUpdateTree(delta) {
  for(const id in delta) {
    if(typeof treeNodes[id] != 'undefined' && delta[id] != null && typeof delta[id].parent == 'undefined') {
      treeNodes[id].innerHTML = jeTreeGetWidgetHTML(widgets.get(id));
    } else if(!jeInMacroExecution) {
      jeDisplayTree();
      if(jeDeltaIsOurs && delta[id] != null && typeof delta[id].id == 'string')
        jeCenterSelection();
      break;
    }
  }
}

function jeDisplayFilteredWidgets(e) {
  const subtext = $('#jeWidgetSearchBox').value.toLowerCase();
  const results = widgetFilter(o => o.get('id').toLowerCase().includes(subtext) ||
          o.get('type') && o.get('type').toLowerCase().includes(subtext) ||
          !o.get('type') && 'basic'.includes(subtext)).sort(
            function(a,b) {
              const na = a.get('id').toLowerCase();
              const nb = b.get('id').toLowerCase();
              return na < nb ? -1 : na > nb ? 1 : 0
            }
          );
  let resultTable = '<table id="jeSearchTable">';
  for(const w of results)
    resultTable += '<tr valign=top><td class="jeInSearchWindow"><i class=key>' + html(w.get('id')) + '</i> - <i class=string>' + html(w.get('type') || 'basic') + '</i></td></tr>';
  resultTable += '</table>';
  $('#jeWidgetSearchResults').innerHTML = resultTable;
  $('#jeWidgetSearchResults').style.display = 'block';

  on('.jeInSearchWindow', 'click', function(e) {
    jeSelectWidget(widgets.get($('.key', e.currentTarget).innerText), false, e.shiftKey);
    if(e.shiftKey)
      e.stopPropagation();
  });

  e.stopPropagation();
}

/* End of tree subpane control */

function jeGetContext() {
  const aO = getSelection().anchorOffset;
  const fO = getSelection().focusOffset;
  const s = Math.min(aO, fO);
  const e = Math.max(aO, fO);
  const v = jeGetEditorContent();

  const select = v.substr(s, Math.min(e-s, 100)).replace(/\n/g, '\\n');
  const line = v.split('\n')[v.substr(0, s).split('\n').length-1];

  if(jeMode == 'macro') {
    jeContext = [ 'Macro' ];
    jeShowCommands();
    return jeContext;
  }

  if(jeMode == 'empty') {
    jeShowCommands();
    return jeContext;
  }

  if(jeMode == 'trace') {
    jeContext = [ 'Trace' ];
    jeShowCommands();
    return jeContext;
  }

  try {
    jeStateNow = JSON.parse(v.replace(/,(?=\n *[\]}],?$)/gm, ''));

    if(!jeStateNow.id)
      jeJSONerror = 'No ID given.';
    else if(JSON.parse(jeStateBefore).id != jeStateNow.id && widgets.has(jeStateNow.id))
      jeJSONerror = `ID ${jeStateNow.id} is already in use.`;
    else if(jeStateNow.parent !== undefined && jeStateNow.parent !== null && !widgets.has(jeStateNow.parent))
      jeJSONerror = `Parent ${jeStateNow.parent} does not exist.`;
    else if(jeStateNow.type == 'card' && (!jeStateNow.deck || !widgets.has(jeStateNow.deck)))
      jeJSONerror = `Deck ${jeStateNow.deck} does not exist.`;
    else if(jeStateNow.type == 'card' && !widgets.get(jeStateNow.deck).get('cardTypes'))
      jeJSONerror = `Given widget ${jeStateNow.deck} is not a deck or doesn't define cardTypes.`;
    else if(jeStateNow.type == 'card' && (!jeStateNow.cardType || !widgets.get(jeStateNow.deck).get('cardTypes')[jeStateNow.cardType]))
      jeJSONerror = `Card type ${jeStateNow.cardType} does not exist in deck ${jeStateNow.deck}.`;
    else
      jeJSONerror = null;
  } catch(e) {
    jeStateNow = null;
    jeJSONerror = e;
  }

  // go through all the lines up until the cursor and use the indentation to figure out the context
  let keys = [ jeStateNow && jeStateNow.type || 'basic' ];
  for(const line of v.split('\n').slice(0, v.substr(0, s).split('\n').length)) {
    const m = line.match(/^( +)(["{])([^"]*)/);
    if(m) {
      const depth = m[1].length/2;
      keys[depth] = m[2]=='{' || line.match(/^ +"[^"]*",?$/) ? (keys[depth] === undefined ? -1 : keys[depth]) + 1 : m[3];
      keys = keys.slice(0, depth+1);
    }
    const mClose = line.match(/^( *)[\]}]/);
    if(mClose)
      keys = keys.slice(0, mClose[1].length/2+1);
  }

  // make sure the context actually exists in the widget
  if(!jeJSONerror) {
    let pointer = jeStateNow;
    for(let i=1; i<keys.length; ++i) {
      if(pointer[keys[i]] === undefined) {
        keys = keys.slice(0, i);
        break;
      }
      pointer = pointer[keys[i]];
    }
  }

  // insert the operation type as a virtual key so commands can check which operation they're in
  try {
    for(let i=1; i<keys.length-1; ++i) {
      if(String(keys[i]).match(/Routine$/) && typeof keys[i+1] == 'number' && !jeJSONerror) {
        const operation = jeGetValue(keys.slice(1, i+2), true);
        const func = typeof operation == 'string' && operation.match(/^var/) ? 'var expression' : operation.func;
        keys.splice(i+2, 0, '(' + (func || String(keys.slice(0, i+2))) + ')');
      }
    }
  } catch(e) {}

  if(select)
    keys.push(`"${select}"`);

  if(jeMode == 'multi') {
    try {
      jeStateNow = JSON.parse(v);

      if(!Array.isArray(jeStateNow.widgets))
        jeJSONerror = 'Key widgets is not an array.';
      else
        jeJSONerror = null;
    } catch(e) {
      jeStateNow = null;
      jeJSONerror = e;
    }
    keys[0] = 'Multi-Selection';
  }

  jeContext = keys;

  jeShowCommands();

  return jeContext;
}

function jeGetEditorContent() {
  return $('#jeText').textContent.replace(/\u00a0/g, ' ');
}

function jeGetLastKey() {
  return jeContext[jeContext.length-1].toString().match(/^"/) ? jeContext[jeContext.length-2] : jeContext[jeContext.length-1];
}

function jeGetValue(context, all) {
  let pointer = jeStateNow;
  for(const key of context || jeContext)
    if(all && pointer[key] !== undefined || typeof pointer[key] == 'object' && pointer[key] !== null)
      pointer = pointer[key];
  return pointer
}

function jeInsert(context, key, value) {
  if(!jeJSONerror) {
    let pointer = jeGetValue(context);
    pointer[key] = '###SELECT ME###';
    jeSetAndSelect(value);
  }
}

// START routine logging

let jeRoutineLogging = false;
let jeRoutineResetOnNextLog = true;
let jeRoutineResult = '';
let jeLoggingHTML = '';
let jeLoggingDepth = 0;
let jeHTMLStack = [];

function jeLoggingJSON(obj) {
  return html(JSON.stringify(obj, null, '  ').split('\n').slice(1, -1).join('\n'));
}

function jeLoggingRoutineStart(widget, property, initialVariables, initialCollections, byReference) {
  if( jeHTMLStack.length == 0 || ['CALL', 'CLICK', 'IF', 'loopRoutine'].indexOf( jeHTMLStack[0][3] ) == -1 ) {
    if(jeRoutineResetOnNextLog) {
      jeLoggingHTML = '';
      jeRoutineResetOnNextLog = false;
    }
    jeLoggingHTML += `
      <div class="jeLog">
        <div class="jeExpander ${jeLoggingDepth ? '' : 'jeExpander-down'}">
          <span class="jeLogWidget">${widget.get('id')}</span>
          <span class="jeLogProperty">${typeof property == 'string' ? property : '--custom--'}</span>
        </div>
        <div class="jeLogNested ${jeLoggingDepth ? '' : 'active'}">
    `;
  }
  ++jeLoggingDepth;
}

function jeLoggingRoutineEnd(variables, collections) {
  if( jeHTMLStack.length == 0 || ['CALL', 'CLICK', 'IF', 'loopRoutine'].indexOf( jeHTMLStack[0][3] ) == -1 ) jeLoggingHTML += '</div></div>';
  --jeLoggingDepth;
  if(!jeLoggingDepth) {
    $('#jeLog').innerHTML = jeLoggingHTML + '</div></div>';
    // Enable the je_toggleDebug button the first time a routine is executed.
    if ( jeDebugViewing == null) {
      jeDebugViewing = false;
      jeShowCommands()
    }

    // Make it so clicking on the arrows expands the subtree
    const expanders = document.getElementsByClassName('jeExpander');
    let i;
    for (i=0; i < expanders.length; i++) {
      expanders[i].addEventListener('click', function() {
        this.classList.toggle('jeExpander-down');
        this.parentNode.querySelector('.jeLogNested').classList.toggle('active');
      });
    }
    // Make expander arrows that are parents of nodes with problems show up red.
    const problems = document.getElementsByClassName('jeLogHasProblems');
    for (i=0; i<problems.length; i++) {
      let node = problems[i];
      while (node && node.id != 'jeLog') {
        if(node.classList.contains('jeLogOperation') || node.classList.contains('jeLog')) {
          node.firstElementChild.classList.remove('jeExpander');
          node.firstElementChild.classList.add('jeRedExpander')
        }
        node = node.parentNode;
      }
    }
  }
}

function jeLoggingRoutineOperationStart(original, applied) {
  let fcn;
  if (typeof applied == 'string')
    if (applied.substring(0,3) == 'var')
      fcn = 'var'
    else if (applied.substring(0,2) == '//')
      fcn = '//'
    else
      fcn = applied
  else
    fcn = applied.func || '<COMMENT>'
  jeHTMLStack.unshift([jeLoggingHTML, original, applied, html(fcn), +new Date()]);
  jeLoggingHTML = '';
}

function jeLoggingRoutineOperationEnd(problems, variables, collections, skipped) {
  const collDisplay = {};
  for(const name in collections)
    collDisplay[name] = collections[name].map(w=>`${html(w.get('id'))} (${html(w.get('type')||'basic')})`);

  const savedHTML = jeHTMLStack.shift();
  const original = savedHTML[1];
  const originalText = jeLoggingJSON(original);
  const applied = savedHTML[2];
  const appliedText  = jeLoggingJSON(applied);
  const opFunction = savedHTML[3];
  const startTime = savedHTML[4];

  const opProblems = problems.length ?
       `<div class="jeLogDetails">
          <div class="jeExpander">
            <span class="jeLogName">Problems</span>
          </div>
          <div class="jeLogNested">
            <div class="jeLogProblems">${jeLoggingJSON(problems)}</div>
          </div>
        </div>` : '';
  const originalOp = originalText.length ?
        `<div class="jeLogOriginal"><h3>Original Operation</h3>${originalText}</div>` : '';
  const appliedOp = appliedText.length ?
        `<div class="jeLogApplied"> <h3>Applied Operation</h3>${appliedText}</div>` : '';
  const opOperation = originalText.length || appliedText.length ?
        `<div class="jeLogDetails">
           <div class="jeExpander">
             <span class="jeLogName">Original and applied operation</span>
           </div>
           <div class="jeLogNested">
             ${originalOp}
             ${appliedOp}
             <h3></h3>
           </div>
         </div>` : '';

  jeLoggingHTML =  `
    ${savedHTML[0]}
    <div class="jeLogOperation ${skipped ? 'jeLogSkipped' : ''} ${problems.length ? 'jeLogHasProblems' : 'jeLogHasNoProblems'}">
      <div class="jeExpander">
        <span class="jeLogName">${opFunction}</span> ${jeRoutineResult} <span class="jeLogTime">(${+new Date() - startTime}ms)</span>
      </div>
      <div class="jeLogNested">
        ${opProblems}
        ${opOperation}
        ${jeLoggingHTML}
        <div class="jeLogDetails">
          <div class="jeExpander">
            <span class="jeLogName">Variables and collections afterwards</span>
          </div>
          <div class="jeLogNested">
            <div class="jeLogVariables"  ><h3>Variables   afterwards</h3>${jeLoggingJSON(variables  )}</div>
            <div class="jeLogCollections"><h3>Collections afterwards</h3>${jeLoggingJSON(collDisplay)}</div>
            <h3></h3>
          </div>
        </div>
      </div>
    </div>
  `;

  jeRoutineResult = '';
}

function jeLoggingRoutineOperationSummary(definition, result) {
  jeRoutineResult = `<span class="jeLogSummary">${html(definition)}</span>
     ${result ? '=&gt;' : ''} <span class="jeLogResult">${html(result || '')}</span>`;
}

// END routine logging

function jeNewline() {
  const s = Math.min(getSelection().anchorOffset, getSelection().focusOffset);
  const match = jeGetEditorContent().substr(0,s).match(/( *)[^\n]*$/);
  jePasteText('\n' + match[1], false);
}

function jePasteText(text, select) {
  const aO = getSelection().anchorOffset;
  const fO = getSelection().focusOffset;
  const s = Math.min(aO, fO);
  const e = Math.max(aO, fO);
  const v = jeGetEditorContent();

  jeSetEditorContent(v.substr(0, s) + text + v.substr(e));
  $('#jeText').focus();
  jeColorize();
  jeSelect(select ? s : s + text.length, s + text.length, false);
}

function jePostProcessObject(o) {
  const copy = { ...o };
  if(!o.inheritFrom)
    for(const key in copy)
      if(copy[key] === null || copy[key] === jeWidget.getDefaultValue(key) || key.match(/in deck/))
        delete copy[key];
  return copy;
}

function jePostProcessText(t) {
  return t;
}

function jePreProcessObject(o) {
  const copy = {};
  for(const key of jeOrder) {
    const match = key.match(/^(.*?)(\*)?(#)?$/);
    if(o[match[1]] !== undefined)
      copy[match[1]] = o[match[1]];
    else if(match[2] == '*' && !o.inheritFrom && (o.type != 'card' || (key != 'width*' && key != 'height*')))
      copy[match[1]] = jeWidget.getDefaultValue(match[1]);
    if(match[3] == '#')
      copy[`LINEBREAK${match[1]}`] = null;
  }

  for(const key of Object.keys(o).sort()) {
    if(copy[key] === undefined && !key.match(/^c[0-9]{2}$/) && !key.match(/Routine$/) && jePlainWidget.getDefaultValue(key) !== undefined)
      copy[key] = o[key];
  }
  copy[`LINEBREAKcustom`] = null;
  for(const key of Object.keys(o).sort())
    if(copy[key] === undefined && !key.match(/^c[0-9]{2}$/) && !key.match(/Routine$/))
      copy[key] = o[key];
  copy[`LINEBREAKroutines`] = null;
  for(const key of Object.keys(o).sort())
    if(copy[key] === undefined && !key.match(/^c[0-9]{2}$/))
      copy[key] = o[key];
  copy[`LINEBREAKcanvas`] = null;
  for(const key of Object.keys(o).sort())
    if(copy[key] === undefined)
      copy[key] = o[key];

  try {
    if(copy.type == 'card') {
      if(widgets.get(copy.deck).state.cardDefaults)
        copy['cardDefaults (in deck)'] = widgets.get(copy.deck).get('cardDefaults');
      if(widgets.get(copy.deck).state.cardTypes)
        copy['cardType ['+ o.cardType + '] (in deck)'] = widgets.get(copy.deck).get('cardTypes')[copy.cardType];
    }
  } catch(e) {}

  return copy;
}

function jePreProcessText(t) {
  return t.replace(/(\n +"LINEBREAK.*": null,)+/g, '\n').replace(/(,\n?\n +"LINEBREAK.*": null)+/g, '');
}

// Select the characters in a given range in the text area.
function jeSelect(start, end, scrollToCursor) {
  const t = $('#jeText');
  const text = t.textContent;
  try {
    t.focus();

    const scroll = t.scrollTop;
    t.textContent = text.substring(0, end);
    const height = t.scrollHeight;
    t.scrollTop = 50000;
    t.textContent = text;

    if(!scrollToCursor) {
      t.scrollTop = scroll;
    } else if(t.scrollTop) {
      if(Math.abs(t.scrollTop + t.clientHeight/2 - scroll) < t.clientHeight*.25)
        t.scrollTop = scroll;
      else
        t.scrollTop += t.clientHeight/2;
    }

    const node = t.firstChild;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const selection = window.getSelection();
    selection.removeAllRanges();

    selection.addRange(range);
  } catch(e) {
    t.textContent = text;
  }
}

// Set the text area to the formatted version of the given text and colorize.
function jeSet(text, dontFocus) {
  try {
    jeSetEditorContent(jePreProcessText(JSON.stringify(jePreProcessObject(JSON.parse(text)), null, '  ')));
  } catch(e) {
    jeSetEditorContent(text);
  }
  if(!dontFocus)
    $('#jeText').focus();
  jeColorize();
}

// Replace ###SELECT ME### in JSON string in jeStateNow by the string given in replaceBy,
// display the results in the text area by calling jeSet, and select the replaced text by calling jeSelect.
function jeSetAndSelect(replaceBy, insideString) {

  const emptyBrackets = replaceBy && (typeof replaceBy === 'object' && Object.keys(replaceBy).length === 0); // ###SELECT ME### should be replaced by [] or {}
  const dollar = replaceBy == '${}'; // ###SELECT ME### should be replaced by ${} (and this will be in a string)

  if(jeMode == 'widget')
    var jsonString = jePreProcessText(JSON.stringify(jePreProcessObject(jeStateNow), null, '  '));
  else
    var jsonString = JSON.stringify(jeStateNow, null, '  ');
  const startIndex = jsonString.indexOf(insideString ? '###SELECT ME###' : '"###SELECT ME###"');
  let length = jsonString.length-15-(insideString ? 0 : 2); // Length of json ignoring string to be replaced.

  // Replace the entire quoted string if the ###SELECT ME### is not inside a string, otherwise
  // just replace ###SELECT ME###
  if(insideString || dollar)
    jsonString = jsonString.replace(/###SELECT ME###/, JSON.stringify(replaceBy).substr(1, JSON.stringify(replaceBy).length-2));
  else
    jsonString = jsonString.replace(/"###SELECT ME###"/, JSON.stringify(replaceBy));

  let insertedLength = jsonString.length - length; // Length of inserted string.

  // Set left and right ranges for selection based on what is being inserted.
  jeSet(jsonString);
  let leftOffset = 0;
  let rightOffset = 0;
  if(emptyBrackets || (typeof replaceBy == 'string' && !insideString && !dollar)){
    leftOffset = rightOffset = 1;
  } else if (dollar) {
    leftOffset = 3;
    rightOffset = 2;
  }

  jeSelect(startIndex + leftOffset, startIndex + insertedLength - rightOffset, true);
}

function jeSetEditorContent(content) {
  $('#jeText').textContent = content.replace(/\u00a0/g, ' ');
}

function jeShowCommands() {

  // First set up top buttons
  let commandText = `<div id='jeTopButtons'>`;
  for(const command of jeCommands) {
    if(command.context == undefined) {
      const name = (typeof command.name == 'function' ? command.name() : command.name);
      const icon = (typeof command.icon == 'function' ? command.icon() : command.icon);
      const material = String(icon).match(/^[^[]/) ? 'material' : '';
      const classes = typeof command.classes == 'function' ? command.classes() : command.classes || '';
      commandText += `<button class='top ${material} ${classes}' id='${command.id}' title='${name}' ${!command.show || command.show() ? '' : 'disabled'}>${icon}</button>`;
    }
  }
  commandText += `</div>`;

  // Next figure out which context commands are active here.
  const activeCommands = {};
  const context = jeContext.join(' ↦ ');
  for(const command of jeCommands) {
    delete command.currentKey;
    const contextMatch = context.match(new RegExp(command.context));
    if(contextMatch && contextMatch[0]!= "" && (!command.context || jeStateNow && !jeJSONerror) && (!command.show || command.show())) {
      if(activeCommands[contextMatch[0]] === undefined)
        activeCommands[contextMatch[0]] = [];
      activeCommands[contextMatch[0]].push(command);
    };
  }

  if(jeContext[jeContext.length-1] == '(var expression)') {
    commandText += `\n  <b>var expression</b>\n<label>Search </label><input id="var_search" name="var_search" type="text"><br>`;
    commandText += `<div id="var_results"></div>\n`;
  }

  if(!jeJSONerror && jeStateNow) {
    const usedKeys = { a: 1, c: 1, x: 1, v: 1, w: 1, n: 1, t: 1, q: 1, j: 1, z: 1 };

    const sortByName = function(a, b) {
      const nameA = typeof a.name == 'function' ? a.name() : a.name;
      const nameB = typeof b.name == 'function' ? b.name() : b.name;
      return nameA.localeCompare(nameB);
    }

    const displayKey = function (k) {
      return { ArrowUp: '⬆', ArrowDown: '⬇'} [k] || k;
    }

    for(const contextMatch of (Object.keys(activeCommands).sort((a,b)=>b.length-a.length))) {
      commandText += `\n  <div class="context">${html(contextMatch)}</div>\n`;
      for(const command of activeCommands[contextMatch].sort(sortByName)) {
        try {
          if(context.match(new RegExp(command.context)) && (!command.show || command.show())) {
            const name = typeof command.name == 'function' ? command.name() : command.name;
            if(command.forceKey && !usedKeys[command.forceKey])
              command.currentKey = command.forceKey;
            for(const key of name.split(''))
              if(key != ' ' && !command.currentKey && !usedKeys[key.toLowerCase()])
                command.currentKey = key.toLowerCase();
            for(const key of 'abcdefghijklmnopqrstuvwxyz1234567890'.split(''))
              if(!command.currentKey && !usedKeys[key])
                command.currentKey = key;
            usedKeys[command.currentKey] = true;
            let keyName = displayKey(command.currentKey);
            // commandText += (keyName !== undefined)? `Ctrl-${keyName}: ` : `no key  `;
            // ${name.replace(keyName, '<b>' + keyName + '</b>')}
            commandText += `<button id="${command.id}">${name}</button>\n`;
          }
        } catch(e) {
          console.error(`Failed to show command ${command.id}`, e);
        }
      }
    }
  }
  commandText += `\n\n${html(context)}\n`;
  if(jeJSONerror) {
    if(jeMode == 'widget')
      commandText += `\nCtrl-Space: go to error\n`;
    commandText += `\n<i class=error>${html(String(jeJSONerror))}</i>\n`;
  }
  if(jeCommandError)
    commandText += `\n<i class=error>Last command failed: ${html(String(jeCommandError))}</i>\n`;
  if(jeSecondaryWidget)
    commandText += `\n\n${html(jeSecondaryWidget)}\n`;
  $('#jeCommands').innerHTML = commandText;
  on('#jeCommands button', 'click', clickButton);

  on('#var_search', 'input', displayComputeOps);
  if ($('#var_results') && jeKeyword !='') {
    $('#var_search').value = jeKeyword;
    displayComputeOps();
  }

  if(jeCommandWithOptions)
    jeCommandOptions();
}

function jeToggle() {
  if(jeEnabled === null) {
    jeAddCommands();
    jeEmpty();
    $('#jeText').addEventListener('input', jeColorize);
    $('#jeText').onscroll = e=>$('#jeTextHighlight').scrollTop = e.target.scrollTop;
  }
  jeEnabled = !jeEnabled;
  jeRoutineLogging = jeEnabled;
  jeLoggingHTML = '';
  if(jeEnabled) {
    $('body').classList.add('jsonEdit');
    if(jeWidget && !widgets.has(jeWidget.id))
      jeEmpty();
    if(jeDebugViewing) {
      jeCallCommand(jeCommands.find(o => o.id == 'je_toggleDebug'));
      jeShowCommands()
    }
    jeDisplayTree();
  } else {
    $('body').classList.remove('jsonEdit');
  }
  setScale();
}

function jeEmpty() {
  jeMode = 'empty';
  jeContext = [ 'No widget selected.' ];
  jeStateNow = null;
  jeWidget = null;

  jeSet('');
  jeShowCommands();
}

const clickButton = async function(event) {
  await jeCallCommand(jeCommands.find(o => o.id == event.currentTarget.id));
  jeGetContext();
  if(jeMode != 'macro' && jeMode != 'empty') {
    if((jeWidget || jeMode == 'multi') && !jeJSONerror)
      await jeApplyChanges();
    if (jeContext[0] == '###SELECT ME###')
      jeGetContext();
  }
}

let widgetCoordCache = null;
window.addEventListener('mousemove', function(e) {
  if(!jeEnabled)
    return;
  const x = jeState.mouseX = Math.floor((e.clientX - roomRectangle.left) / scale);
  const y = jeState.mouseY = Math.floor((e.clientY - roomRectangle.top ) / scale);

  if(!jeZoomOut && x > 1600 || jeMouseButtonIsDown)
    return;

  if(!widgetCoordCache) {
    widgetCoordCache = [];
    for(const widget of widgets.values()) {
      const coords = widget.coordGlobalFromCoordParent({x:widget.get('x'),y:widget.get('y')});
      coords.r = coords.x + widget.get('width');
      coords.b = coords.y + widget.get('height');
      coords.widget = widget;
      widgetCoordCache.push(coords);
    }
  }

  const hoveredWidgets = widgetCoordCache.filter(c=>x>=c.x && x<=c.r && y>=c.y && y<=c.b).map(c=>c.widget);

  hoveredWidgets.sort(function(w1,w2) {
    const hiddenParent =  function(widget) {
      return widget ? widget.domElement.classList.contains('foreign') || hiddenParent(widgets.get(widget.get('parent'))) : false;
    };

    const w1card = w1.get('type') == 'card';
    const w2card = w2.get('type') == 'card';
    const w1foreign = !w1card && hiddenParent(w1);
    const w2foreign =  !w2card && hiddenParent(w2);
    const w1normal = !w1foreign && !w1card;
    const w2normal = !w2foreign && !w2card;
    return ((w1card && w2card) || (w1foreign && w2foreign) || (w1normal && w2normal)) ?
      jeFKeyOrderDescending*(w2.calculateZ() - w1.calculateZ()) :
      ((w1card && !w2card) || (w1foreign && w2normal)) ? 1 : -1;
  });

  for(let i=1; i<=11; ++i) {
    const hotkey = i>=4 ? i+1 : i;
    if(hoveredWidgets[i-1]) {
      jeWidgetLayers[hotkey] = hoveredWidgets[i-1];
      var deck = `${hoveredWidgets[i-1].get('type')}` == 'card' ? `\ndeck: ${hoveredWidgets[i-1].get('deck')}` : "";
      var cardType = `${hoveredWidgets[i-1].get('type')}` == 'card' ? `\ncardType: ${hoveredWidgets[i-1].get('cardType')}` : "";
      $(`#jeWidgetLayer${hotkey}`).textContent = `F${hotkey}: ${hoveredWidgets[i-1].get('id')}\ntype: ${hoveredWidgets[i-1].get('type') || 'basic'} ${deck} ${cardType}`;
    } else {
      delete jeWidgetLayers[hotkey];
      $(`#jeWidgetLayer${hotkey}`).textContent = '';
    }
  }

  if((roomRectangle.left <= e.clientX && e.clientX <= roomRectangle.right && roomRectangle.top <= e.clientY && e.clientY <= roomRectangle.bottom) || jeZoomOut) {
    $('#jeMouseCoords').innerHTML = "(" + jeState.mouseX + ", " + jeState.mouseY + ")";
  } else {
    $('#jeMouseCoords').innerHTML = ""
  }
});

window.addEventListener('mousedown', _=>jeMouseButtonIsDown = jeEnabled);
window.addEventListener('mouseup', async function(e) {
  if(!jeEnabled)
    return;
  jeRoutineResetOnNextLog = true;
  jeMouseButtonIsDown = false;

  if(e.target == $('#jeText') && jeContext != 'macro') // Click in widget text, fix context
    jeGetContext();
});

onLoad(function() {
  on('#jeText', 'paste', function(e) {
    const paste = (e.clipboardData || window.clipboardData).getData('text');
    jePasteText(paste, false);
    e.preventDefault();
  });
});

window.addEventListener('keydown', async function(e) {
  if(e.ctrlKey && e.key == 'j') {
    e.preventDefault();
    jeToggle();
  }
  if(!jeEnabled)
    return;

  if(e.key == 'Control')
    jeState.ctrl = true;
  if(e.key == 'Shift')
    jeState.shift = true;

  if(e.ctrlKey) {
    if(e.key == ' ' && jeMode == 'widget') {
      const locationLine = String(jeJSONerror).match(/line ([0-9]+) column ([0-9]+)/);
      if(locationLine) {
        const pos = jeGetEditorContent().split('\n').slice(0, locationLine[1]-1).join('\n').length + +locationLine[2];
        jeSelect(pos, pos, true);
      }

      const locationPostion = String(jeJSONerror).match(/position ([0-9]+)/);
      if(locationPostion)
        jeSelect(+locationPostion[1], +locationPostion[1], true);
    // } else {
    //   for(const command of jeCommands) {
    //     if(command.currentKey == e.key) {
    //       e.preventDefault();
    //       try {
    //         jeCommandError = null;
    //         await jeCallCommand(command);
    //       } catch(e) {
    //         jeCommandError = e;
    //       }
    //     }
    //   }
    }
  }

  const functionKey = e.key.match(/F([0-9]+)/);
  if(functionKey && jeWidgetLayers[+functionKey[1]]) {
    e.preventDefault();
    if(e.ctrlKey) {
      let id = jeWidgetLayers[+functionKey[1]].get('id');
      if(jeContext[jeContext.length-1] == '"null"')
        id = `"${id}"`;
      jePasteText(id, true);
    } else {
      jeSelectWidget(jeWidgetLayers[+functionKey[1]], false, e.shiftKey);
    }
  }
});

on('#jsonEditor', 'keydown', function(e) {
  if(e.key == 'Enter') {
    jeNewline();
    e.preventDefault();
  }
});

window.addEventListener('click', function(e) {
  if(jeEnabled && e.target != $('#jeWidgetSearchResults')) {
    $('#jeWidgetSearchBox').value = '';
    $('#jeWidgetSearchResults').style.display = 'none';
  }
});

window.addEventListener('keydown', function(e) {
  if(!jeEnabled)
    return;
  if(e.key != 'Control')
    jeKeyIsDown = true;
});

window.addEventListener('keyup', function(e) {
  if(!jeEnabled)
    return;
  if(e.key == 'Control')
    jeState.ctrl = false;
  if(e.key == 'Shift')
    jeState.shift = false;

  if(e.target == $('#jeText')) {
    jeGetContext();
    if((jeWidget || jeMode == 'multi') && !jeJSONerror)
      jeApplyChanges();
  }
  jeKeyIsDown = false;
  jeKeyIsDownDeltas = [];
});
