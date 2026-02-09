import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../services/area_service.dart';
import '../../services/profile_service.dart';

class CustomerProfileScreen extends StatefulWidget {
  const CustomerProfileScreen({super.key});

  @override
  State<CustomerProfileScreen> createState() => _CustomerProfileScreenState();
}

class _CustomerProfileScreenState extends State<CustomerProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _flatController = TextEditingController();
  final _apartmentController = TextEditingController();
  final _streetController = TextEditingController();
  String? _selectedArea;
  bool _saving = false;

  final _areaService = AreaService();
  final _profileService = ProfileService();

  @override
  void dispose() {
    _nameController.dispose();
    _flatController.dispose();
    _apartmentController.dispose();
    _streetController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;

    setState(() => _saving = true);
    await _profileService.updateCustomerProfile(
      uid: user.uid,
      name: _nameController.text.trim(),
      phone: user.phoneNumber ?? '',
      flat: _flatController.text.trim(),
      apartment: _apartmentController.text.trim(),
      street: _streetController.text.trim(),
      area: _selectedArea ?? '',
    );

    if (mounted) {
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Profile saved')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Customer Profile')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: ListView(
            children: [
              TextFormField(
                controller: _nameController,
                decoration: const InputDecoration(
                  labelText: 'Name',
                  border: OutlineInputBorder(),
                ),
                validator: (value) =>
                    value == null || value.trim().isEmpty
                        ? 'Enter your name'
                        : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                enabled: false,
                initialValue: FirebaseAuth.instance.currentUser?.phoneNumber ?? '',
                decoration: const InputDecoration(
                  labelText: 'Mobile Number',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _flatController,
                decoration: const InputDecoration(
                  labelText: 'Flat / Door No',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _apartmentController,
                decoration: const InputDecoration(
                  labelText: 'Apartment Name (optional)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _streetController,
                decoration: const InputDecoration(
                  labelText: 'Street',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                stream: _areaService.watchAreas(),
                builder: (context, snapshot) {
                  final docs = snapshot.data?.docs ?? [];
                  final areas = docs
                      .map((doc) => doc.data()['name'] as String?)
                      .whereType<String>()
                      .toList();

                  if (_selectedArea == null && areas.isNotEmpty) {
                    _selectedArea = areas.first;
                  }

                  return DropdownButtonFormField<String>(
                    value: _selectedArea,
                    decoration: const InputDecoration(
                      labelText: 'Area',
                      border: OutlineInputBorder(),
                    ),
                    items: areas
                        .map((area) => DropdownMenuItem(
                              value: area,
                              child: Text(area),
                            ))
                        .toList(),
                    onChanged: (value) => setState(() => _selectedArea = value),
                    validator: (value) => value == null || value.isEmpty
                        ? 'Select your area'
                        : null,
                  );
                },
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
                      : const Text('Save Profile'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
