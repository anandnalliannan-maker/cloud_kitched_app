import 'package:flutter/material.dart';

class MenuFormScreen extends StatefulWidget {
  const MenuFormScreen({
    super.key,
    required this.onSubmit,
    this.initialName,
    this.initialDescription,
    this.initialQuantity,
    this.initialPrice,
    this.initialEnabled,
  });

  final Future<void> Function({
    required String name,
    required String description,
    required int quantity,
    required int price,
    required bool enabled,
  }) onSubmit;

  final String? initialName;
  final String? initialDescription;
  final int? initialQuantity;
  final int? initialPrice;
  final bool? initialEnabled;

  @override
  State<MenuFormScreen> createState() => _MenuFormScreenState();
}

class _MenuFormScreenState extends State<MenuFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _descController = TextEditingController();
  final _qtyController = TextEditingController();
  final _priceController = TextEditingController();
  bool _enabled = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _nameController.text = widget.initialName ?? '';
    _descController.text = widget.initialDescription ?? '';
    _qtyController.text = widget.initialQuantity?.toString() ?? '';
    _priceController.text = widget.initialPrice?.toString() ?? '';
    _enabled = widget.initialEnabled ?? true;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descController.dispose();
    _qtyController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _saving = true);
    await widget.onSubmit(
      name: _nameController.text.trim(),
      description: _descController.text.trim(),
      quantity: int.parse(_qtyController.text.trim()),
      price: int.parse(_priceController.text.trim()),
      enabled: _enabled,
    );
    if (mounted) {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Menu Item')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: ListView(
            children: [
              TextFormField(
                controller: _nameController,
                decoration: const InputDecoration(
                  labelText: 'Item name',
                  border: OutlineInputBorder(),
                ),
                validator: (value) =>
                    value == null || value.trim().isEmpty
                        ? 'Enter item name'
                        : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _descController,
                decoration: const InputDecoration(
                  labelText: 'Description',
                  border: OutlineInputBorder(),
                ),
                maxLines: 3,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _qtyController,
                decoration: const InputDecoration(
                  labelText: 'Quantity available',
                  border: OutlineInputBorder(),
                ),
                keyboardType: TextInputType.number,
                validator: (value) {
                  final qty = int.tryParse(value ?? '');
                  if (qty == null || qty < 0) return 'Enter valid quantity';
                  return null;
                },
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _priceController,
                decoration: const InputDecoration(
                  labelText: 'Price (INR)',
                  border: OutlineInputBorder(),
                ),
                keyboardType: TextInputType.number,
                validator: (value) {
                  final price = int.tryParse(value ?? '');
                  if (price == null || price <= 0) return 'Enter valid price';
                  return null;
                },
              ),
              const SizedBox(height: 12),
              SwitchListTile(
                value: _enabled,
                onChanged: (value) => setState(() => _enabled = value),
                title: const Text('Enabled'),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _saving ? null : _save,
                  child: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Save'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
